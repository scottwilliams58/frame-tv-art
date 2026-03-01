import os
import base64
import json
import time
from io import BytesIO
from flask import Flask, render_template, request, jsonify
from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

_instance_path = '/tmp/frame_tv_art_instance'
os.makedirs(_instance_path, exist_ok=True)

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


def get_art(ip, timeout=10):
    """Return a SamsungTVArt instance connected directly to the art-app endpoint.

    Using SamsungTVArt directly (instead of SamsungTVWS.art()) avoids the
    token-file conflict where the main remote-control WebSocket and the art-app
    WebSocket overwrite each other's tokens on every request, causing the TV to
    prompt for permission on every single call.
    """
    try:
        from samsungtvws import SamsungTVArt
    except ImportError:
        raise RuntimeError(
            "samsungtvws is not installed. Run: pip install -r requirements.txt"
        )
    return SamsungTVArt(
        host=ip,
        port=8002,
        token_file=TOKEN_FILE,
        name='FrameArtApp',
        timeout=timeout,
    )


def with_retry(fn, retries=2, delay=1.5):
    """Call fn(), retrying on TV connection/timeout errors (ms.channel.timeOut etc.)."""
    last_exc = None
    for attempt in range(retries + 1):
        try:
            return fn()
        except Exception as e:
            last_exc = e
            err_str = str(e).lower()
            retriable = any(kw in err_str for kw in ('timeout', 'connection', 'channel'))
            if not retriable or attempt >= retries:
                raise
            time.sleep(delay)
    raise last_exc  # unreachable, but satisfies type checkers


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/connect', methods=['POST'])
def connect():
    data = request.get_json()
    ip = (data or {}).get('ip', '').strip()
    if not ip:
        return jsonify({'success': False, 'error': 'IP address is required'})

    try:
        art = get_art(ip)
        # supported() uses REST (HTTP) — no WebSocket needed, no permission prompt
        supported = art.supported()
        artmode = None
        if supported:
            def do_connect():
                a = get_art(ip)
                with a:
                    return a.get_artmode()
            try:
                artmode = with_retry(do_connect)
            except Exception:
                artmode = 'unknown'
        return jsonify({'success': True, 'art_supported': supported, 'artmode': artmode})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/upload', methods=['POST'])
def upload():
    data = request.get_json()
    ip = (data or {}).get('ip', '').strip()
    image_b64 = (data or {}).get('image', '')
    matte = (data or {}).get('matte', 'none')
    show_after = (data or {}).get('show', True)

    if not ip:
        return jsonify({'success': False, 'error': 'TV IP address is required'})
    if not image_b64:
        return jsonify({'success': False, 'error': 'No image data provided'})

    # Strip data URL prefix
    if ',' in image_b64:
        image_b64 = image_b64.split(',', 1)[1]

    try:
        raw = base64.b64decode(image_b64)
        img = Image.open(BytesIO(raw)).convert('RGB')
    except Exception as e:
        return jsonify({'success': False, 'error': f'Invalid image data: {e}'})

    temp_path = os.path.join(UPLOAD_FOLDER, 'upload_temp.jpg')
    img.save(temp_path, 'JPEG', quality=95, optimize=True)

    try:
        def do_upload():
            a = get_art(ip)
            with a:
                # samsungtvws >= 3.x removed the 'show' kwarg from upload().
                # Upload first, then call select_image() to display it.
                content_id = a.upload(temp_path, matte=matte)
                if content_id and show_after:
                    try:
                        a.select_image(content_id, show=True)
                    except Exception:
                        pass  # display failure is non-fatal
            return content_id

        content_id = with_retry(do_upload)
        return jsonify({'success': True, 'content_id': content_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.route('/api/artworks', methods=['GET'])
def artworks():
    ip = request.args.get('ip', '').strip()
    if not ip:
        return jsonify({'success': False, 'error': 'IP address is required'})
    try:
        def do_list():
            a = get_art(ip)
            with a:
                # Fetch all content; the library filters by category_id client-side.
                # Passing no category avoids a TV-side filter that can cause timeouts.
                return a.available() or []

        items = with_retry(do_list)
        return jsonify({'success': True, 'artworks': items})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/select', methods=['POST'])
def select():
    data = request.get_json()
    ip = (data or {}).get('ip', '').strip()
    content_id = (data or {}).get('content_id', '').strip()
    if not ip or not content_id:
        return jsonify({'success': False, 'error': 'IP and content_id are required'})
    try:
        def do_select():
            a = get_art(ip)
            with a:
                a.select_image(content_id, show=True)

        with_retry(do_select)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/artmode', methods=['POST'])
def artmode():
    data = request.get_json()
    ip = (data or {}).get('ip', '').strip()
    mode = (data or {}).get('mode', 'on')
    if not ip:
        return jsonify({'success': False, 'error': 'IP address is required'})
    try:
        def do_set():
            a = get_art(ip)
            with a:
                a.set_artmode(mode)

        with_retry(do_set)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/artmode/settings', methods=['GET'])
def get_artmode_settings():
    ip = request.args.get('ip', '').strip()
    if not ip:
        return jsonify({'success': False, 'error': 'IP required'})
    try:
        def do_get():
            a = get_art(ip)
            with a:
                return a.get_artmode_settings()

        raw = with_retry(do_get)

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
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/artmode/settings', methods=['POST'])
def set_artmode_settings():
    data = request.get_json()
    ip = (data or {}).get('ip', '').strip()
    settings = (data or {}).get('settings', {})
    if not ip:
        return jsonify({'success': False, 'error': 'IP required'})
    if not settings:
        return jsonify({'success': False, 'error': 'No settings provided'})
    try:
        def do_set():
            a = get_art(ip)
            with a:
                a.set_artmode_settings(settings)

        with_retry(do_set)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, port=port, host='0.0.0.0', threaded=True)
