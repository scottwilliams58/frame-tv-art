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
- `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py` — All routes, input validation, and TV interaction live here. Routes are thin: validate input, call `get_tv_conn(ip).execute(ip, fn)`, return JSON.

### 3. TV communication layer
- `TVConnection` class (app.py:127–187) — Manages a single persistent `SamsungTVArt` WebSocket per TV IP. A `threading.Lock` serialises concurrent Flask requests so only one operation runs at a time per TV. The connection is opened lazily on first use and kept alive across requests. On failure the connection is dropped and re-opened once if the error is retriable (timeout / connection / channel / broken pipe).
- `samsungtvws.SamsungTVArt` — Third-party library imported lazily inside `TVConnection._connect()`. Communicates with the TV over WebSocket (port 8002). The app uses `SamsungTVArt` directly rather than `SamsungTVWS.art()` to avoid token-file conflicts that cause repeated pairing prompts.

## Data Flow

### Image upload (single mode)
1. User drops or browses a file in the browser.
2. `Cropper.js` renders the image for interactive crop/rotate/flip.
3. On upload click: `cropper.getCroppedCanvas()` produces a `<canvas>`, encoded to a base64 JPEG data URL.
4. `fetch('/api/upload', { method: 'POST', body: JSON.stringify({ ip, image: dataURL, matte, show }) })`.
5. Flask `upload()` route: strips the data URL prefix, base64-decodes, opens with Pillow, converts to RGB, writes a temporary JPEG to `uploads/upload_temp.jpg`.
6. `get_tv_conn(ip).execute(ip, do_upload)` runs the upload closure on the persistent connection. `_CONNECT_TIMEOUT` (90 s) is used as both the WebSocket pairing timeout and the D2D socket timeout for the file transfer.
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
2. Flask instantiates a short-lived `SamsungTVArt` (10 s timeout, no WebSocket open) and calls `art.supported()` via HTTP REST — no WebSocket, no pairing prompt.
3. If supported, `get_tv_conn(ip).execute(ip, lambda a: a.get_artmode())` opens the persistent WebSocket connection. The user may see the TV's pairing dialog here — but only once, because subsequent calls reuse this same `TVConnection` rather than opening a new socket.
4. Response: `{ art_supported, artmode }`. The browser uses this to reveal the upload cards and Art Mode tab.

### Art Mode settings read/write
- GET `/api/artmode/settings`: calls `get_tv_conn(ip).execute(ip, ...)` with `a.get_artmode_settings()`, then normalises the TV's varied response shapes (dict with JSON-encoded `data` string, plain list, or flat dict) into a consistent `{ key: value }` object.
- POST `/api/artmode/settings`: splits the payload — standard settings go to `a.set_artmode_settings()`, while `motion_timer`, `motion_sensitivity`, and `brightness_sensor` each have dedicated TV commands (`set_motion_timer`, `set_motion_sensitivity`, `set_brightness_sensor_setting`).

## Abstractions

### `TVConnection` — `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py:127`
Holds a single `SamsungTVArt` WebSocket and a `threading.Lock`. Key methods:
- `execute(ip, fn)` — acquires the lock, ensures the connection is open (calling `_connect` if needed), runs `fn(art)`, and retries once on retriable errors. Non-retriable exceptions propagate immediately.
- `_connect(ip)` — tears down any stale socket, creates a new `SamsungTVArt(timeout=_CONNECT_TIMEOUT)`, calls `art.open()` (blocks until `MS_CHANNEL_READY_EVENT` or timeout), and hardens the token file to `0o600`.
- `_close_art()` — calls `art.close()` and sets `self._art = None`.

### `get_tv_conn(ip)` — `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py:195`
Factory protected by `_tv_conns_lock`. Returns the existing `TVConnection` for the given IP, or creates and stores a new one. The module-level `_tv_conns` dict and `_tv_conns_lock` ensure safe concurrent access from Flask's threaded WSGI worker.

### `_CONNECT_TIMEOUT = 90` — `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py:124`
Single constant used as both the WebSocket pairing wait (long enough for the user to accept the TV's dialog) and the D2D socket timeout during image upload (long enough for large JPEG transfers). Replaces the per-call timeout parameters that existed on the old `get_art()` helper.

### `_err(msg, exc)` — `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py:100`
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
  ├─ get_tv_conn(ip)           → returns existing TVConnection (or creates one)
  ├─ .execute(ip, lambda a: a.select_image(content_id, show=True))
  │    ├─ acquires TVConnection._lock
  │    ├─ opens WebSocket if not already open (_connect)
  │    ├─ calls fn(art)
  │    └─ on retriable error: closes socket, waits 1.5 s, reconnects once
  └─ jsonify({'success': True})
       │
Browser receives JSON, updates UI state
```

### Error path
Any exception inside `TVConnection.execute` that is not retriable, or that fails on the second attempt, propagates to the route's `except` block, which calls `_err(human_message, exc)`. `_err` logs the real exception via Python logging and returns `{'success': False, 'error': human_message}`. The browser checks `data.success` and calls `showToast(data.error, 'error')`.

## Security Measures

- Flask instance path stored in `~/.cache/frame-tv-art` (mode `0o700`) rather than world-readable `/tmp`.
- `MAX_CONTENT_LENGTH = 100 MB` limits request body size.
- `Image.MAX_IMAGE_PIXELS = 100_000_000` caps PIL decompression to prevent decompression-bomb attacks.
- IP validated as a parsed address (not hostname) to block SSRF.
- All TV-sourced data rendered via DOM text nodes / `setAttribute`, never `innerHTML`, to prevent XSS.
- Token file permissions enforced at `0o600` after each write.
- External CDN scripts loaded with SRI hashes (`integrity` attributes).
- `FLASK_DEBUG` defaults to `'0'`; debug mode must be explicitly opted into via environment variable.
