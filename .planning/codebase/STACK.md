# STACK.md — Technology Stack

## Languages

| Layer    | Language           | Version constraint |
|----------|--------------------|--------------------|
| Backend  | Python 3           | `python3` (no pin; system interpreter) |
| Frontend | HTML5 / CSS3       | Static, no transpile |
| Frontend | JavaScript (ES2020+) | Vanilla; uses `async/await`, `fetch`, `Canvas API` |
| Launcher | Zsh shell          | macOS `.command` double-click launcher |
| Dev util | Bash               | `run.sh` thin wrapper |

## Runtime

- **Python 3** — system install, invoked via `python3 app.py`
- **No virtual environment committed** — `venv/` and `env/` are `.gitignore`d; operators are expected to create their own
- **Port** — `5001` (default); overridable via `PORT` env var
- **Host** — `127.0.0.1` (default); overridable via `FRAME_TV_HOST` env var
- **Flask instance path** — `~/.cache/frame-tv-art` (mode `0700`); kept off `/tmp`
- **Upload temp dir** — `<repo>/uploads/` (gitignored); cleaned up after each request
- **Token file** — `<repo>/samsung_tv_token.txt` (gitignored); permissions set to `0600` at runtime

## Backend Framework

**Flask >= 3.0.0** (`flask>=3.0.0` in `requirements.txt`)

- `Flask` app object defined in `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py`
- `render_template` — Jinja2 template engine (bundled with Flask) for `templates/index.html`
- `request`, `jsonify` — standard Flask request/response helpers
- `app.config['MAX_CONTENT_LENGTH'] = 100 MB` — upload size guard
- `threaded=True` — multi-threaded dev server

Routes defined in `app.py`:

| Method | Path                    | Purpose                          |
|--------|-------------------------|----------------------------------|
| GET    | `/`                     | Serve single-page HTML UI        |
| POST   | `/api/connect`          | Test TV reachability + art mode  |
| POST   | `/api/upload`           | Upload JPEG artwork to TV        |
| GET    | `/api/artworks`         | List artworks stored on TV       |
| POST   | `/api/select`           | Display a stored artwork on TV   |
| POST   | `/api/artmode`          | Toggle Art Mode on/off           |
| GET    | `/api/artmode/settings` | Fetch Art Mode settings from TV  |
| POST   | `/api/artmode/settings` | Save Art Mode settings to TV     |
| GET    | `/api/mattes`           | Fetch supported matte list       |

## Python Dependencies

Source: `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/requirements.txt`

| Package             | Version constraint | Role |
|---------------------|--------------------|------|
| `flask`             | `>=3.0.0`          | HTTP server and routing |
| `samsungtvws`       | `>=2.6.0`          | Samsung TV WebSocket API client |
| `Pillow`            | `>=10.0.0`         | Image decode, convert, resize, save |
| `websocket-client`  | `>=1.6.0`          | WebSocket transport used by `samsungtvws` |

Standard library modules used: `os`, `re`, `base64`, `json`, `time`, `ipaddress`, `logging`, `io.BytesIO`

## Frontend Libraries (CDN, SRI-pinned)

Loaded in `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/templates/index.html`:

| Library      | Version  | Source                           | SRI hash present |
|--------------|----------|----------------------------------|------------------|
| Cropper.js   | 1.6.1    | cdnjs.cloudflare.com             | Yes (`sha384-…`)  |
| Lucide icons | 0.575.0  | unpkg.com (UMD build)            | Yes (`sha384-…`)  |

Both scripts and the Cropper CSS use `crossorigin="anonymous"` + `integrity` attributes (SRI enforcement).

## Frontend Architecture

Single-page application — no build step, no bundler, no framework.

- `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/static/js/app.js` — all application logic (~770 lines vanilla JS)
- `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/static/css/style.css` — all styling (~870 lines, CSS custom properties, dark theme)
- `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/templates/index.html` — Jinja2 template, single HTML file (~400 lines)

Key browser APIs used: `fetch`, `Canvas 2D`, `FileReader`/`URL.createObjectURL`, `DataTransfer` (drag-and-drop), `localStorage` (none — state is in-memory only)

## Image Processing

Handled server-side in `app.py` using **Pillow**:

- Accepted input formats: JPEG, PNG, WEBP, MPO (HEIC silently converted via PIL)
- Output: JPEG, quality 95, optimized
- Decompression bomb limit: `Image.MAX_IMAGE_PIXELS = 100_000_000` (~100 MP)
- Client-side pre-processing: `Cropper.js` crop → `canvas.toDataURL('image/jpeg', 0.95)` → base64 payload in JSON POST body

## Build Tools

None. No package.json, no Makefile, no Dockerfile, no CI configuration.

## Launch / Run Scripts

| File | Shell | Purpose |
|------|-------|---------|
| `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/run.sh` | Bash | Minimal wrapper: `cd` + `exec python3 app.py` |
| `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/Launch Frame TV Art.command` | Zsh | macOS double-click launcher: kills any prior instance on port 5001, starts server, waits for it to be ready, opens browser |

## Configuration

All configuration is via **environment variables** (no config file):

| Env var          | Default       | Effect |
|------------------|---------------|--------|
| `PORT`           | `5001`        | HTTP listen port |
| `FRAME_TV_HOST`  | `127.0.0.1`   | HTTP listen address |
| `FLASK_DEBUG`    | `0`           | Enable Flask debug mode (set `'1'` to enable) |

Runtime paths:
- Instance path: `~/.cache/frame-tv-art/` (mode `0700`)
- Upload temp: `<repo>/uploads/upload_temp.jpg` (deleted after each upload)
- TV auth token: `<repo>/samsung_tv_token.txt` (mode `0600`)

## Security Hardening

Implemented in `app.py`:

- IP input validated via `ipaddress.ip_address()` — rejects hostnames (SSRF prevention)
- Matte/content IDs validated against `^[A-Za-z0-9_\-]+$` regex
- Art Mode settings validated with strict type/range checks before forwarding to TV
- `Image.MAX_IMAGE_PIXELS` cap guards against decompression bombs
- Flask `MAX_CONTENT_LENGTH` = 100 MB caps raw upload size
- Frontend uses `textContent`/`setAttribute` (not `innerHTML`) for TV-sourced data (XSS prevention)
- SRI hashes on all CDN resources
- Token file permissions: `0600`; instance folder: `0700`
- `FLASK_DEBUG` defaults to `'0'`
