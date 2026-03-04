import os
import re
import base64
import json
import time
import ipaddress
import logging
import threading
import tempfile
from io import BytesIO
from flask import Flask, render_template, request, jsonify
from PIL import Image

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-8s  %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger(__name__)

# ── PIL decompression-bomb protection ────────────────────────────────────────
Image.MAX_IMAGE_PIXELS = 100_000_000

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Keep Flask's instance folder (and the TV token) out of world-readable /tmp
_instance_path = os.path.expanduser('~/.cache/frame-tv-art')
os.makedirs(_instance_path, mode=0o700, exist_ok=True)

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, 'templates'),
    static_folder=os.path.join(BASE_DIR, 'static'),
    instance_path=_instance_path,
)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB

UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')

# Bug #10 fix: store the token in the secure instance directory, not next to
# app.py where it could end up in a world-readable location or a git repo.
TOKEN_FILE = os.path.join(_instance_path, 'samsung_tv_token.txt')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# ── Custom error handlers (return JSON, not HTML) ─────────────────────────────

@app.errorhandler(413)
def too_large(e):
    return jsonify({'success': False, 'error': 'Image file too large (max 100 MB)'}), 413


@app.errorhandler(400)
def bad_request(e):
    return jsonify({'success': False, 'error': 'Malformed request'}), 400


@app.after_request
def set_security_headers(resp):
    resp.headers['X-Frame-Options'] = 'DENY'
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' https://cdnjs.cloudflare.com https://unpkg.com; "
        "style-src 'self' https://cdnjs.cloudflare.com; "
        "img-src 'self' blob: data:; "
        "font-src 'self'"
    )
    resp.headers['Server'] = 'FrameArtApp'
    return resp


# ── Input validation helpers ──────────────────────────────────────────────────

def validate_ip(ip_str: str) -> bool:
    """Accept only routable IPv4/IPv6 addresses — no hostnames, loopback, or SSRF.

    Bug #11 fix: ipaddress.ip_address() previously accepted ::1 (IPv6 loopback)
    and link-local addresses.  We now explicitly reject those.
    """
    try:
        addr = ipaddress.ip_address(ip_str)
        if addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_unspecified:
            return False
        return True
    except ValueError:
        return False


# Matte IDs and content IDs: alphanumeric, underscore, hyphen only.
_SAFE_ID_RE = re.compile(r'^[A-Za-z0-9_\-]+$')

def validate_matte_id(matte: str) -> bool:
    return matte == 'none' or bool(_SAFE_ID_RE.match(matte))


def validate_content_id(cid: str) -> bool:
    return bool(cid) and bool(_SAFE_ID_RE.match(cid))


_VALID_MOTION_TIMERS  = {'off', '5', '15', '30', '60', '120', '240'}
_VALID_MOTION_SENS    = {'1', '2', '3'}
_VALID_COLOR_TEMPS    = {'cool', 'natural', 'warm1', 'warm2'}
_VALID_ARTMODE_MODES  = {'on', 'off'}
# Bug #12 fix: allowlist matching the HTML <select> options.
_VALID_DISPLAY_TIMERS = {'1', '3', '5', '10', '15', '30', '60', '180', '720', '1440'}

def validate_artmode_settings(s: dict) -> list:
    """Return a list of validation error strings (empty = all good)."""
    errors = []
    if 'brightness' in s:
        try:
            val = int(s['brightness'])
            if not (1 <= val <= 10):
                errors.append('brightness must be 1–10')
        except (TypeError, ValueError):
            errors.append('brightness must be an integer')
    # Bug #12 fix: was int()-only check with no range/allowlist.
    if 'display_timer' in s and str(s['display_timer']) not in _VALID_DISPLAY_TIMERS:
        valid = ', '.join(sorted(_VALID_DISPLAY_TIMERS, key=int))
        errors.append(f'display_timer must be one of: {valid}')
    if 'color' in s and s['color'] not in _VALID_COLOR_TEMPS:
        errors.append(f"color must be one of {sorted(_VALID_COLOR_TEMPS)}")
    if 'shuffle' in s and not isinstance(s['shuffle'], bool):
        errors.append('shuffle must be a boolean')
    if 'motion_timer' in s and str(s['motion_timer']) not in _VALID_MOTION_TIMERS:
        errors.append(f"motion_timer must be one of {sorted(_VALID_MOTION_TIMERS)}")
    if 'motion_sensitivity' in s and str(s['motion_sensitivity']) not in _VALID_MOTION_SENS:
        errors.append('motion_sensitivity must be 1, 2, or 3')
    if 'brightness_sensor' in s and not isinstance(s['brightness_sensor'], bool):
        errors.append('brightness_sensor must be a boolean')
    return errors


def _err(msg: str, exc=None) -> dict:
    """Log exc internally; return a sanitised JSON-safe error dict."""
    if exc is not None:
        logger.error('%s: %s', msg, exc)
    return {'success': False, 'error': msg}


# ── Library bug fix: token=None in WebSocket URL ──────────────────────────────
#
# samsungtvws 3.0.4 always appends &token=None to the wss:// URL when no token
# file exists.  Some Frame TV firmwares (including QN50LS03DAFXZA) respond with
# ms.channel.timeOut when they see the literal string "None" as the token value,
# but respond correctly (ms.channel.ready or ms.channel.unauthorized) when the
# token param is simply absent.
#
# Fix: subclass SamsungTVArt and override _format_websocket_url to omit the
# token query param entirely when no token is available.

class _FixedSamsungTVArt:
    """Mixin: omit &token= from WebSocket URL when _get_token() returns falsy."""

    _SSL_URL_NO_TOKEN = "wss://{host}:{port}/api/v2/channels/{app}?name={name}"

    def _format_websocket_url(self, app: str) -> str:
        from samsungtvws import helper as _tvws_helper
        token = self._get_token()
        if token:
            return super()._format_websocket_url(app)
        # No token — omit the param entirely so the TV shows a pairing dialog
        # instead of responding with ms.channel.timeOut.
        params = {
            "host": self.host,
            "port": self.port,
            "app": app,
            "name": _tvws_helper.serialize_string(self.name),
        }
        return self._SSL_URL_NO_TOKEN.format(**params)


# ── Persistent TV connection manager ─────────────────────────────────────────
#
# Samsung Frame TVs show a pairing dialog every time a NEW WebSocket connection
# is opened to the art-app channel.  We keep one persistent SamsungTVArt per
# IP, opened once and reused across all routes.

# 90 s covers both the pairing-dialog wait and the D2D image-transfer socket.
_CONNECT_TIMEOUT = 90
# Reduced socket timeout for normal API commands after the connection is
# established.  Bug #5 fix: previously all ops used the full 90 s timeout.
_OP_TIMEOUT = 20


class TVConnection:
    """Manages a single persistent WebSocket connection to a Samsung Frame TV."""

    def __init__(self):
        self._art = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    def execute(self, ip: str, fn):
        """Run fn(art) using the live connection, reconnecting once on failure.

        Bug #1 fix: _connect() was previously called OUTSIDE the try/except,
        so connection-phase failures (TV refuses handshake, pairing timeout)
        bypassed the retry loop entirely.  Moving it inside the try block means
        both connection failures and fn() failures are handled uniformly.
        """
        with self._lock:
            for attempt in range(2):
                try:
                    if self._art is None or not self._art.is_alive():
                        self._connect(ip)
                    return fn(self._art)
                except Exception as e:
                    logger.warning('TV call failed (attempt %d): %s', attempt + 1, e)
                    self._close_art()
                    err_str = str(e).lower()
                    retriable = (
                        'unauthorized' not in type(e).__name__.lower()
                        and any(kw in err_str for kw in ('timeout', 'connection', 'channel', 'broken', 'pipe'))
                    )
                    if attempt == 0 and retriable:
                        time.sleep(1.5)
                        continue
                    raise

    # ------------------------------------------------------------------
    def _connect(self, ip: str):
        """Open a new WebSocket to the TV (caller must hold self._lock)."""
        try:
            from samsungtvws import SamsungTVArt
        except ImportError:
            raise RuntimeError(
                "samsungtvws is not installed. Run: pip install -r requirements.txt"
            )
        # Use _FixedSamsungTVArt which omits &token=None from the WebSocket URL.
        class _ArtTV(_FixedSamsungTVArt, SamsungTVArt):
            pass
        self._close_art()
        logger.info('Opening TV connection to %s (timeout=%ds)', ip, _CONNECT_TIMEOUT)
        art = _ArtTV(
            host=ip,
            port=8002,
            token_file=TOKEN_FILE,
            name='FrameArtApp',
            timeout=_CONNECT_TIMEOUT,
        )
        try:
            art.open()
        except Exception as _open_exc:
            # When the TV sends MS_CHANNEL_UNAUTHORIZED the library raises
            # UnauthorizedError without saving any token it may have included.
            # Two sub-cases:
            #  A) TV included a pending token in the UNAUTHORIZED response
            #     (some firmware versions do this before the user taps Allow).
            #     Save it so the next connect attempt carries it and the TV
            #     can match it to the accepted pairing.
            #  B) TV sent UNAUTHORIZED with no token — our stored token is
            #     stale/invalid.  Delete it so the next connect starts fresh
            #     and triggers a proper pairing dialog instead of looping
            #     forever on the stale token.
            try:
                from samsungtvws.exceptions import UnauthorizedError as _UnauthErr
                if isinstance(_open_exc, _UnauthErr):
                    _resp = _open_exc.args[0] if _open_exc.args else {}
                    _new_token = (
                        _resp.get("data", {}).get("token")
                        if isinstance(_resp, dict) else None
                    )
                    if _new_token:
                        with open(TOKEN_FILE, "w") as _tf:
                            _tf.write(_new_token)
                        os.chmod(TOKEN_FILE, 0o600)
                        logger.info(
                            "Pairing token saved — accept the TV dialog then click Connect again"
                        )
                    else:
                        # Stale / rejected token — clear it so the next attempt
                        # presents a fresh pairing dialog.
                        try:
                            os.remove(TOKEN_FILE)
                            logger.info("Stale token cleared — pairing dialog will appear on TV")
                        except FileNotFoundError:
                            pass
            except Exception:
                pass  # non-critical; user can still retry
            raise

        # Bug #5 fix: reduce the WebSocket socket timeout now that the connection
        # is established.  _CONNECT_TIMEOUT (90 s) was needed during open() for the
        # pairing dialog; normal commands need far less.  Note: art.timeout (still
        # 90 s) is separately used by the D2D upload socket, which we deliberately
        # leave long for large image transfers.
        try:
            art.connection.settimeout(_OP_TIMEOUT)
        except Exception:
            pass  # non-critical; 90 s is still safe if this fails

        if os.path.exists(TOKEN_FILE):
            os.chmod(TOKEN_FILE, 0o600)
        self._art = art
        logger.info('TV connection established to %s', ip)

    def _close_art(self):
        """Close the WebSocket. Caller must hold self._lock."""
        if self._art is not None:
            try:
                self._art.close()
            except Exception:
                pass
            self._art = None


# One TVConnection per IP — created on first use, reused thereafter.
_tv_conns: dict = {}
_tv_conns_lock = threading.Lock()


def get_tv_conn(ip: str) -> TVConnection:
    with _tv_conns_lock:
        if ip not in _tv_conns:
            _tv_conns[ip] = TVConnection()
        return _tv_conns[ip]


# ── Routes ────────────────────────────────────────────────────────────────────
# Bug #6 fix: all error responses previously returned HTTP 200.
# Validation errors now return 400, TV communication failures return 502.

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/connect', methods=['POST'])
def connect():
    data = request.get_json()
    ip = (data or {}).get('ip', '').strip()
    if not ip:
        return jsonify(_err('IP address is required')), 400
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address')), 400

    try:
        from samsungtvws import SamsungTVArt
    except ImportError:
        return jsonify(_err('samsungtvws is not installed')), 500

    try:
        # supported() uses REST (HTTP) — no WebSocket, no pairing prompt.
        class _ArtTV(_FixedSamsungTVArt, SamsungTVArt):
            pass
        art_check = _ArtTV(host=ip, port=8002, token_file=TOKEN_FILE,
                           name='FrameArtApp', timeout=10)
        supported = art_check.supported()

        artmode = None
        if supported:
            artmode = get_tv_conn(ip).execute(ip, lambda a: a.get_artmode())

        return jsonify({'success': True, 'art_supported': supported, 'artmode': artmode})

    except Exception as e:
        # Bug #8 fix: distinguish pairing/auth failures so the client can show
        # the right hint without relying on fragile regex matching of error text.
        err_type = type(e).__name__.lower()
        err_str  = str(e).lower()
        is_pairing = (
            'unauthorized' in err_type
            or any(kw in err_str for kw in ('unauthorized', 'token', 'pair', 'denied'))
        )
        if is_pairing:
            return jsonify({
                'success': False,
                'error':   'TV pairing required — check your TV screen.',
                'pairing': True,
            }), 401
        logger.error('connect: %s', e)
        return jsonify(_err('Could not connect to TV', e)), 502


@app.route('/api/upload', methods=['POST'])
def upload():
    data = request.get_json()
    ip        = (data or {}).get('ip', '').strip()
    image_b64 = (data or {}).get('image', '')
    matte     = (data or {}).get('matte', 'none')
    show_after= (data or {}).get('show', True)

    if not ip:
        return jsonify(_err('TV IP address is required')), 400
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address')), 400
    if not image_b64:
        return jsonify(_err('No image data provided')), 400
    if not validate_matte_id(str(matte)):
        return jsonify(_err('Invalid matte identifier')), 400

    # Strip data URL prefix
    if ',' in image_b64:
        image_b64 = image_b64.split(',', 1)[1]

    try:
        raw = base64.b64decode(image_b64)
        img = Image.open(BytesIO(raw))
        img = img.convert('RGB')
    except Image.DecompressionBombError as e:
        return jsonify(_err('Image is too large to process safely', e)), 400
    except Exception as e:
        return jsonify(_err('Invalid image data', e)), 400

    fd, temp_path = tempfile.mkstemp(suffix='.jpg', dir=UPLOAD_FOLDER)
    os.close(fd)
    try:
        img.save(temp_path, 'JPEG', quality=95, optimize=True)

        def do_upload(a):
            # upload() transfers the full JPEG over a D2D socket; _CONNECT_TIMEOUT
            # (90 s) is used as the D2D socket timeout, so large files are fine.
            content_id = a.upload(temp_path, matte=matte)
            if content_id and show_after:
                try:
                    a.select_image(content_id, show=True)
                except Exception:
                    pass  # display failure is non-fatal
            return content_id

        content_id = get_tv_conn(ip).execute(ip, do_upload)
        return jsonify({'success': True, 'content_id': content_id})
    except Exception as e:
        return jsonify(_err('Upload to TV failed', e)), 502
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.route('/api/artworks', methods=['GET'])
def artworks():
    ip = request.args.get('ip', '').strip()
    if not ip:
        return jsonify(_err('IP address is required')), 400
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address')), 400
    try:
        items = get_tv_conn(ip).execute(ip, lambda a: a.available() or [])
        return jsonify({'success': True, 'artworks': items})
    except Exception as e:
        return jsonify(_err('Could not fetch artwork list', e)), 502


@app.route('/api/select', methods=['POST'])
def select():
    data = request.get_json()
    ip         = (data or {}).get('ip', '').strip()
    content_id = (data or {}).get('content_id', '').strip()
    if not ip:
        return jsonify(_err('IP address is required')), 400
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address')), 400
    if not validate_content_id(content_id):
        return jsonify(_err('Invalid content ID')), 400
    try:
        get_tv_conn(ip).execute(ip, lambda a: a.select_image(content_id, show=True))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify(_err('Could not select artwork', e)), 502


@app.route('/api/artmode', methods=['POST'])
def artmode():
    data = request.get_json()
    ip   = (data or {}).get('ip', '').strip()
    mode = (data or {}).get('mode', 'on')
    if not ip:
        return jsonify(_err('IP address is required')), 400
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address')), 400
    if mode not in _VALID_ARTMODE_MODES:
        return jsonify(_err('mode must be "on" or "off"')), 400
    try:
        get_tv_conn(ip).execute(ip, lambda a: a.set_artmode(mode))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify(_err('Could not change Art Mode', e)), 502


@app.route('/api/artmode/settings', methods=['GET'])
def get_artmode_settings():
    ip = request.args.get('ip', '').strip()
    if not ip:
        return jsonify(_err('IP required')), 400
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address')), 400
    try:
        raw = get_tv_conn(ip).execute(ip, lambda a: a.get_artmode_settings())

        # Normalise the response: the TV may return a dict with a JSON-encoded
        # 'data' list, a plain list, or a flat dict.
        settings = {}
        if isinstance(raw, dict):
            data_field = raw.get('data')
            if isinstance(data_field, str):
                try:
                    data_list = json.loads(data_field)
                    if isinstance(data_list, list):
                        settings = {
                            item['item']: item.get('value')
                            for item in data_list
                            if isinstance(item, dict) and 'item' in item
                        }
                except (json.JSONDecodeError, KeyError):
                    pass
            if not settings:
                settings = {
                    k: v for k, v in raw.items()
                    if k not in ('event', 'request_id', 'id', 'data')
                }
        elif isinstance(raw, list):
            settings = {
                item['item']: item.get('value')
                for item in raw
                if isinstance(item, dict) and 'item' in item
            }

        return jsonify({'success': True, 'settings': settings})
    except Exception as e:
        return jsonify(_err('Could not fetch Art Mode settings', e)), 502


@app.route('/api/mattes', methods=['GET'])
def get_mattes():
    """Return the TV's supported matte types and colour variants.

    Inspired by NickWaterton/samsung-tv-ws-api (LGPL-3.0).  See CREDITS.md.
    """
    ip = request.args.get('ip', '').strip()
    if not ip:
        return jsonify(_err('IP required')), 400
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address')), 400
    try:
        result = get_tv_conn(ip).execute(ip, lambda a: a.get_matte_list())
        return jsonify({'success': True, 'mattes': result})
    except Exception as e:
        return jsonify(_err('Could not fetch matte list', e)), 502


@app.route('/api/artmode/settings', methods=['POST'])
def set_artmode_settings():
    data = request.get_json()
    ip = (data or {}).get('ip', '').strip()
    # Copy so we can pop motion/sensor fields without mutating the original
    settings = dict((data or {}).get('settings', {}))
    if not ip:
        return jsonify(_err('IP required')), 400
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address')), 400
    if not settings:
        return jsonify(_err('No settings provided')), 400

    errors = validate_artmode_settings(settings)
    if errors:
        return jsonify(_err('; '.join(errors))), 400

    # These are sent via dedicated TV commands, not set_artmode_settings().
    # API insight from NickWaterton/samsung-tv-ws-api — see CREDITS.md.
    motion_timer       = settings.pop('motion_timer', None)
    motion_sensitivity = settings.pop('motion_sensitivity', None)
    brightness_sensor  = settings.pop('brightness_sensor', None)

    # Pop individual settings from dict for targeted method dispatch.
    # The samsungtvws library does not expose a set_artmode_settings(); we must
    # call each setter individually.
    brightness = settings.pop('brightness', None)
    color      = settings.pop('color', None)
    shuffle    = settings.pop('shuffle', None)
    display_timer = settings.pop('display_timer', None)

    try:
        def do_set(a):
            if brightness is not None:
                a.set_brightness(int(brightness))
            if color is not None:
                a.set_color_temperature(color)
            # set_slideshow_status handles both shuffle and display_timer together.
            # duration=0 means off; type=True means shuffled.
            if shuffle is not None or display_timer is not None:
                kwargs = {}
                if display_timer is not None:
                    kwargs['duration'] = int(display_timer)
                if shuffle is not None:
                    kwargs['type'] = bool(shuffle)
                a.set_slideshow_status(**kwargs)
            if motion_timer is not None:
                a.set_motion_timer(str(motion_timer))
            if motion_sensitivity is not None:
                a.set_motion_sensitivity(str(motion_sensitivity))
            if brightness_sensor is not None:
                a.set_brightness_sensor_setting(brightness_sensor)

        get_tv_conn(ip).execute(ip, do_set)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify(_err('Could not save Art Mode settings', e)), 502


if __name__ == '__main__':
    port  = int(os.environ.get('PORT', 5001))
    # Default to localhost-only. Set FRAME_TV_HOST=0.0.0.0 only if you need
    # LAN access from another device (and accept the security trade-off).
    host  = os.environ.get('FRAME_TV_HOST', '127.0.0.1')
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    logger.info('Starting on http://%s:%d  (debug=%s)', host, port, debug)
    app.run(debug=debug, port=port, host=host, threaded=True)
