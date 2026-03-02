# Architecture

## Pattern

Single-page application with a thin Flask backend acting as a secure proxy between the browser and the Samsung Frame TV's WebSocket API. The backend handles all TV communication; the browser never connects to the TV directly.

```
Browser SPA  <-->  Flask HTTP API  <-->  samsungtvws (WebSocket)  <-->  Samsung Frame TV
```

The pattern is intentionally flat: there are no models, no ORM, no service classes, no blueprints. All backend logic lives in one file (`app.py`). All frontend logic lives in one file (`static/js/app.js`). The architecture prioritizes simplicity over layering.

## Layers

### 1. Presentation layer (browser)
- `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/templates/index.html` — Single Jinja2 template; all HTML rendered server-side on first load, no client-side routing.
- `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/static/css/style.css` — Flat CSS with CSS custom properties for theming; no preprocessor.
- `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/static/js/app.js` — Vanilla JS; no framework, no build step. Manages all UI state as module-level variables.

### 2. API layer (Flask)
- `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py` — All routes, input validation, and TV interaction live here. Routes are thin: validate input, call `get_art()`, call `with_retry()`, return JSON.

### 3. TV communication layer (library)
- `samsungtvws.SamsungTVArt` — Third-party library imported lazily inside `get_art()`. Communicates with the TV over WebSocket (port 8002). The app uses `SamsungTVArt` directly rather than `SamsungTVWS.art()` to avoid token-file conflicts that cause repeated pairing prompts.

## Data Flow

### Image upload (single mode)
1. User drops or browses a file in the browser.
2. `Cropper.js` renders the image for interactive crop/rotate/flip.
3. On upload click: `cropper.getCroppedCanvas()` produces a `<canvas>`, encoded to a base64 JPEG data URL.
4. `fetch('/api/upload', { method: 'POST', body: JSON.stringify({ ip, image: dataURL, matte, show }) })`.
5. Flask `upload()` route: strips the data URL prefix, base64-decodes, opens with Pillow, converts to RGB, writes a temporary JPEG to `uploads/upload_temp.jpg`.
6. `get_art(ip, timeout=90)` opens a `SamsungTVArt` WebSocket connection.
7. `a.upload(temp_path, matte=matte)` transfers the JPEG to the TV; returns a `content_id`.
8. If `show_after` is true, `a.select_image(content_id, show=True)` displays the image.
9. Temp file is deleted in a `finally` block. `content_id` is returned to the browser as JSON.

### Image upload (bulk mode)
1. User adds multiple files to the queue via `fileInputBulk` or drag-drop.
2. Each file gets a canvas-generated thumbnail (`generateThumb`) stored in `bulkQueue[]`.
3. `uploadBulk()` iterates the queue sequentially; each item is auto-cropped via `autoCropToDataURL()` and sent to `/api/upload`.
4. Only the last item in the batch sets `show: true` so the TV displays the final upload.

### TV connection handshake
1. Browser posts IP to `/api/connect`.
2. Flask calls `art.supported()` via HTTP REST (no WebSocket, no pairing prompt).
3. If supported, a 30-second-timeout WebSocket is opened to call `art.get_artmode()`. The long timeout gives the user time to accept the TV's first-time pairing dialog without the app retrying (which would spawn additional pairing dialogs).
4. Response: `{ art_supported, artmode }`. The browser uses this to reveal the upload cards and Art Mode tab.

### Art Mode settings read/write
- GET `/api/artmode/settings`: opens a WebSocket, calls `a.get_artmode_settings()`, normalises the TV's varied response shapes (dict with JSON-encoded `data` string, plain list, or flat dict) into a consistent `{ key: value }` object.
- POST `/api/artmode/settings`: splits the payload — standard settings go to `a.set_artmode_settings()`, while `motion_timer`, `motion_sensitivity`, and `brightness_sensor` each have dedicated TV commands (`set_motion_timer`, `set_motion_sensitivity`, `set_brightness_sensor_setting`).

## Abstractions

### `get_art(ip, timeout)` — `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py:108`
Factory function. Returns a `SamsungTVArt` instance configured with the shared token file and a caller-specified timeout. Permissions on the token file are hardened to `0o600` on each call. Import of `samsungtvws` is deferred to here so the app starts even if the library is missing (producing a clear error message at runtime).

### `with_retry(fn, retries, delay)` — `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py:135`
Thin retry wrapper. Calls `fn()` up to `retries+1` times, catching only retriable errors (timeout, connection, channel keywords in the exception message). Non-retriable exceptions propagate immediately. Used on every TV operation except the initial pairing handshake (where retry would cause multiple pairing dialogs).

### `_err(msg, exc)` — `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py:99`
Sanitised error response helper. Logs the real exception internally via `logger.error`; returns only a human-readable string to the client, preventing exception details from leaking.

### Input validators — `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py:46–96`
- `validate_ip()` — uses `ipaddress.ip_address()` to accept only well-formed IPv4/IPv6 addresses, blocking SSRF via hostnames.
- `validate_matte_id()` — regex `^[A-Za-z0-9_\-]+$` or `'none'`.
- `validate_content_id()` — same regex, non-empty.
- `validate_artmode_settings()` — validates brightness range, enum fields, and boolean types; returns a list of error strings.

### Client-side `api()` helper — `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/static/js/app.js:89`
Thin `fetch` wrapper. Adds `Content-Type: application/json`, serialises body, deserialises response. All browser-to-server calls go through this function.

## Entry Points

| Entry point | Purpose |
|---|---|
| `python3 app.py` | Start Flask server directly (development) |
| `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/run.sh` | Thin shell wrapper: `cd` to script dir then `exec python3 app.py` |
| `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/Launch Frame TV Art.command` | macOS double-click launcher (zsh): kills any existing process on port 5001, starts `python3 app.py`, polls until server is ready, opens browser tab |

The Flask `__main__` block reads three environment variables:
- `PORT` (default `5001`)
- `FRAME_TV_HOST` (default `127.0.0.1` — localhost only)
- `FLASK_DEBUG` (default `'0'`)

## Request Lifecycle

### Typical API request (e.g., POST /api/select)

```
Browser
  └─ fetch('/api/select', { ip, content_id })
       │
Flask route: select()
  ├─ request.get_json()
  ├─ validate_ip(ip)           → 400-style JSON error if invalid
  ├─ validate_content_id(cid)  → 400-style JSON error if invalid
  ├─ define do_select() closure
  │    └─ get_art(ip, timeout=20)
  │         └─ SamsungTVArt(host, port=8002, token_file, name, timeout)
  │    └─ context manager: a.__enter__() opens WebSocket, authenticates
  │    └─ a.select_image(content_id, show=True)
  │    └─ a.__exit__() closes WebSocket
  ├─ with_retry(do_select)     → retries on timeout/connection errors
  └─ jsonify({'success': True})
       │
Browser receives JSON, updates UI state
```

### Error path
Any exception inside `with_retry` that is not retriable, or that exhausts retries, propagates to the route's `except` block, which calls `_err(human_message, exc)`. `_err` logs the real exception via Python logging and returns `{'success': False, 'error': human_message}`. The browser checks `data.success` and calls `showToast(data.error, 'error')`.

## Security Measures

- Flask instance path stored in `~/.cache/frame-tv-art` (mode `0o700`) rather than world-readable `/tmp`.
- `MAX_CONTENT_LENGTH = 100 MB` limits request body size.
- `Image.MAX_IMAGE_PIXELS = 100_000_000` caps PIL decompression to prevent decompression-bomb attacks.
- IP validated as a parsed address (not hostname) to block SSRF.
- All TV-sourced data rendered via DOM text nodes / `setAttribute`, never `innerHTML`, to prevent XSS.
- Token file permissions enforced at `0o600` after each write.
- External CDN scripts loaded with SRI hashes (`integrity` attributes).
- `FLASK_DEBUG` defaults to `'0'`; debug mode must be explicitly opted into via environment variable.
