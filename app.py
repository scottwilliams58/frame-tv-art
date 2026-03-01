import os
import base64
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


def get_tv(ip):
    try:
        from samsungtvws import SamsungTVWS
    except ImportError:
        raise RuntimeError(
            "samsungtvws is not installed. Run: pip install -r requirements.txt"
        )
    return SamsungTVWS(
        host=ip,
        port=8002,
        token_file=TOKEN_FILE,
        name='FrameArtApp',
    )


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
        tv = get_tv(ip)
        with tv:
            art = tv.art()
            supported = art.supported()
            artmode = None
            if supported:
                try:
                    artmode = art.get_artmode()
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
        tv = get_tv(ip)
        with tv:
            content_id = tv.art().upload(temp_path, matte=matte, show=show_after)
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
        tv = get_tv(ip)
        with tv:
            items = tv.art().available('MY-C0002') or []
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
        tv = get_tv(ip)
        with tv:
            tv.art().select_image(content_id, show=True)
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
        tv = get_tv(ip)
        with tv:
            tv.art().set_artmode(mode)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/artmode/settings', methods=['GET'])
def get_artmode_settings():
    ip = request.args.get('ip', '').strip()
    if not ip:
        return jsonify({'success': False, 'error': 'IP required'})
    try:
        tv = get_tv(ip)
        with tv:
            raw = tv.art().get_artmode_settings()
        if isinstance(raw, list):
            settings = {item['item']: item.get('value') for item in raw if isinstance(item, dict) and 'item' in item}
        elif isinstance(raw, dict):
            settings = raw
        else:
            settings = {}
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
        tv = get_tv(ip)
        with tv:
            tv.art().set_artmode_settings(settings)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, port=port, host='0.0.0.0', threaded=True)
