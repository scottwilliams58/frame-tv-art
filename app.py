import os
import re
import base64
import json
import time
import ipaddress
import logging
import threading
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
# Allow up to ~10 000 × 10 000 (100 MP).  Anything larger is almost certainly
# a decompression-bomb; PIL will raise DecompressionBombError automatically.
Image.MAX_IMAGE_PIXELS = 100_000_000

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Keep Flask's instance folder out of world-readable /tmp
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
TOKEN_FILE = os.path.join(BASE_DIR, 'samsung_tv_token.txt')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ── Input validation helpers ──────────────────────────────────────────────────

def validate_ip(ip_str: str) -> bool:
    """Accept only well-formed IPv4 or IPv6 addresses (no hostnames / SSRF)."""
    try:
        ipaddress.ip_address(ip_str)
        return True
    except ValueError:
        return False


# Matte IDs and content IDs: alphanumeric, underscore, hyphen only.
_SAFE_ID_RE = re.compile(r'^[A-Za-z0-9_\-]+$')

def validate_matte_id(matte: str) -> bool:
    return matte == 'none' or bool(_SAFE_ID_RE.match(matte))


def validate_content_id(cid: str) -> bool:
    return bool(cid) and bool(_SAFE_ID_RE.match(cid))


_VALID_MOTION_TIMERS    = {'off', '5', '15', '30', '60', '120', '240'}
_VALID_MOTION_SENS      = {'1', '2', '3'}
_VALID_COLOR_TEMPS      = {'cool', 'natural', 'warm1', 'warm2'}
_VALID_ARTMODE_MODES    = {'on', 'off'}

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
    if 'display_timer' in s:
        try:
            int(s['display_timer'])
        except (TypeError, ValueError):
            errors.append('display_timer must be an integer')
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


# ── Persistent TV connection manager ─────────────────────────────────────────
#
# Samsung Frame TVs show a pairing dialog every time a NEW WebSocket connection
# is opened to the art-app channel (com.samsung.art-app).  The previous pattern
# of creating a fresh SamsungTVArt + open() + close() per Flask request caused
# 3-6 dialogs per "Connect" click (connect + loadArtworks + loadMattes each
# opened their own connection, and with_retry multiplied that by up to 3×).
#
# Fix: one persistent SamsungTVArt connection per TV IP, opened once and reused
# across all routes.  A threading.Lock serialises concurrent Flask requests so
# only one operation runs at a time per TV (preventing simultaneous reconnects).
#
# The connection is opened lazily on first use and kept alive.  If a call fails
# with a retriable error the connection is dropped and re-opened once.

# Long enough for the user to see and accept the TV's pairing dialog.
# Also used as the D2D socket timeout during image upload.
_CONNECT_TIMEOUT = 90


class TVConnection:
    """Manages a single persistent WebSocket connection to a Samsung Frame TV."""

    def __init__(self):
        self._art = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    def execute(self, ip: str, fn):
        """Run fn(art) using the live connection, reconnecting once on failure."""
        with self._lock:
            for attempt in range(2):
                if self._art is None or not self._art.is_alive():
                    self._connect(ip)          # may block up to _CONNECT_TIMEOUT
                try:
                    return fn(self._art)
                except Exception as e:
                    logger.warning('TV call failed (attempt %d): %s', attempt + 1, e)
                    self._close_art()
                    err_str = str(e).lower()
                    retriable = any(
                        kw in err_str
                        for kw in ('timeout', 'connection', 'channel', 'broken', 'pipe')
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
        self._close_art()   # tear down any stale socket first
        logger.info('Opening TV connection to %s (timeout=%ds)', ip, _CONNECT_TIMEOUT)
        art = SamsungTVArt(
            host=ip,
            port=8002,
            token_file=TOKEN_FILE,
            name='FrameArtApp',
            timeout=_CONNECT_TIMEOUT,
        )
        art.open()          # blocks until MS_CHANNEL_READY_EVENT (or timeout)
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

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/connect', methods=['POST'])
def connect():
    data = request.get_json()
    ip = (data or {}).get('ip', '').strip()
    if not ip:
        return jsonify(_err('IP address is required'))
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address'))

    try:
        from samsungtvws import SamsungTVArt
    except ImportError:
        return jsonify(_err('samsungtvws is not installed'))

    try:
        # supported() uses REST (HTTP) — no WebSocket, no pairing prompt.
        art_check = SamsungTVArt(host=ip, port=8002, token_file=TOKEN_FILE,
                                 name='FrameArtApp', timeout=10)
        supported = art_check.supported()

        artmode = None
        if supported:
            # Open the persistent connection.  The user may see the TV's pairing
            # dialog here — but only once, because subsequent calls reuse this
            # connection rather than opening a new one.
            artmode = get_tv_conn(ip).execute(ip, lambda a: a.get_artmode())

        return jsonify({'success': True, 'art_supported': supported, 'artmode': artmode})
    except Exception as e:
        return jsonify(_err('Could not connect to TV', e))


@app.route('/api/upload', methods=['POST'])
def upload():
    data = request.get_json()
    ip        = (data or {}).get('ip', '').strip()
    image_b64 = (data or {}).get('image', '')
    matte     = (data or {}).get('matte', 'none')
    show_after= (data or {}).get('show', True)

    if not ip:
        return jsonify(_err('TV IP address is required'))
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address'))
    if not image_b64:
        return jsonify(_err('No image data provided'))
    if not validate_matte_id(str(matte)):
        return jsonify(_err('Invalid matte identifier'))

    # Strip data URL prefix
    if ',' in image_b64:
        image_b64 = image_b64.split(',', 1)[1]

    try:
        raw = base64.b64decode(image_b64)
        img = Image.open(BytesIO(raw))
        img = img.convert('RGB')
    except Image.DecompressionBombError as e:
        return jsonify(_err('Image is too large to process safely', e))
    except Exception as e:
        return jsonify(_err('Invalid image data', e))

    temp_path = os.path.join(UPLOAD_FOLDER, 'upload_temp.jpg')
    img.save(temp_path, 'JPEG', quality=95, optimize=True)

    try:
        def do_upload(a):
            # upload() transfers the full JPEG over a D2D socket; _CONNECT_TIMEOUT
            # (90 s) is also used as the D2D socket timeout, so large files are fine.
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
        return jsonify(_err('Upload to TV failed', e))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.route('/api/artworks', methods=['GET'])
def artworks():
    ip = request.args.get('ip', '').strip()
    if not ip:
        return jsonify(_err('IP address is required'))
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address'))
    try:
        items = get_tv_conn(ip).execute(ip, lambda a: a.available() or [])
        return jsonify({'success': True, 'artworks': items})
    except Exception as e:
        return jsonify(_err('Could not fetch artwork list', e))


@app.route('/api/select', methods=['POST'])
def select():
    data = request.get_json()
    ip         = (data or {}).get('ip', '').strip()
    content_id = (data or {}).get('content_id', '').strip()
    if not ip:
        return jsonify(_err('IP address is required'))
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address'))
    if not validate_content_id(content_id):
        return jsonify(_err('Invalid content ID'))
    try:
        get_tv_conn(ip).execute(ip, lambda a: a.select_image(content_id, show=True))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify(_err('Could not select artwork', e))


@app.route('/api/artmode', methods=['POST'])
def artmode():
    data = request.get_json()
    ip   = (data or {}).get('ip', '').strip()
    mode = (data or {}).get('mode', 'on')
    if not ip:
        return jsonify(_err('IP address is required'))
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address'))
    if mode not in _VALID_ARTMODE_MODES:
        return jsonify(_err('mode must be "on" or "off"'))
    try:
        get_tv_conn(ip).execute(ip, lambda a: a.set_artmode(mode))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify(_err('Could not change Art Mode', e))


@app.route('/api/artmode/settings', methods=['GET'])
def get_artmode_settings():
    ip = request.args.get('ip', '').strip()
    if not ip:
        return jsonify(_err('IP required'))
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address'))
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
                # Fall back to returning the raw dict minus protocol fields
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
        return jsonify(_err('Could not fetch Art Mode settings', e))


@app.route('/api/mattes', methods=['GET'])
def get_mattes():
    """Return the TV's supported matte types and colour variants.

    Inspired by NickWaterton/samsung-tv-ws-api (LGPL-3.0), which exposed
    get_matte_list() and demonstrated how to use it to build dynamic matte UIs.
    See CREDITS.md for full attribution.
    """
    ip = request.args.get('ip', '').strip()
    if not ip:
        return jsonify(_err('IP required'))
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address'))
    try:
        result = get_tv_conn(ip).execute(ip, lambda a: a.get_matte_list())
        return jsonify({'success': True, 'mattes': result})
    except Exception as e:
        return jsonify(_err('Could not fetch matte list', e))


@app.route('/api/artmode/settings', methods=['POST'])
def set_artmode_settings():
    data = request.get_json()
    ip = (data or {}).get('ip', '').strip()
    # Copy so we can pop motion/sensor fields without mutating the original
    settings = dict((data or {}).get('settings', {}))
    if not ip:
        return jsonify(_err('IP required'))
    if not validate_ip(ip):
        return jsonify(_err('Invalid IP address'))
    if not settings:
        return jsonify(_err('No settings provided'))

    errors = validate_artmode_settings(settings)
    if errors:
        return jsonify(_err('; '.join(errors)))

    # These are sent via dedicated TV commands, not set_artmode_settings().
    # API insight from NickWaterton/samsung-tv-ws-api — see CREDITS.md.
    motion_timer       = settings.pop('motion_timer', None)
    motion_sensitivity = settings.pop('motion_sensitivity', None)
    brightness_sensor  = settings.pop('brightness_sensor', None)

    try:
        def do_set(a):
            if settings:
                a.set_artmode_settings(settings)
            if motion_timer is not None:
                a.set_motion_timer(str(motion_timer))
            if motion_sensitivity is not None:
                a.set_motion_sensitivity(str(motion_sensitivity))
            if brightness_sensor is not None:
                a.set_brightness_sensor_setting(brightness_sensor)

        get_tv_conn(ip).execute(ip, do_set)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify(_err('Could not save Art Mode settings', e))


if __name__ == '__main__':
    port  = int(os.environ.get('PORT', 5001))
    # Default to localhost-only. Set FRAME_TV_HOST=0.0.0.0 only if you need
    # LAN access from another device (and accept the security trade-off).
    host  = os.environ.get('FRAME_TV_HOST', '127.0.0.1')
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    logger.info('Starting on http://%s:%d  (debug=%s)', host, port, debug)
    app.run(debug=debug, port=port, host=host, threaded=True)
