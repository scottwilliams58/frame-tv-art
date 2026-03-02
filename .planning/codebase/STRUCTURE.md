# Structure

## Directory Layout

```
frame-tv-art/
├── app.py                          # Flask application — all backend logic
├── requirements.txt                # Python dependencies
├── run.sh                          # Shell launch wrapper
├── Launch Frame TV Art.command     # macOS double-click launcher (zsh)
├── CREDITS.md                      # Third-party attribution (NickWaterton, DSR!)
├── .gitignore
│
├── templates/
│   └── index.html                  # Single Jinja2 template (full app HTML)
│
├── static/
│   ├── css/
│   │   └── style.css               # All styles — flat CSS, no preprocessor
│   └── js/
│       └── app.js                  # All client logic — vanilla JS, no build step
│
├── uploads/                        # Transient JPEG temp files (git-ignored)
│   └── upload_temp.jpg             # Created per upload, deleted in finally block
│
├── samsung_tv_token.txt            # TV pairing token (git-ignored, mode 0o600)
│
└── .planning/
    └── codebase/
        ├── ARCHITECTURE.md
        └── STRUCTURE.md
```

Runtime paths not in the repo tree:
- `~/.cache/frame-tv-art/` — Flask instance folder (mode `0o700`, created on startup)

## Key File Locations

| File | Absolute Path | Role |
|---|---|---|
| Backend entry point | `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py` | Flask app, all routes, TV helpers, input validation |
| HTML template | `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/templates/index.html` | Single-page UI shell; loaded once on `GET /` |
| Frontend logic | `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/static/js/app.js` | All client-side state, API calls, Cropper.js integration |
| Styles | `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/static/css/style.css` | Dark theme, component styles, responsive grid |
| Dependencies | `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/requirements.txt` | `flask`, `samsungtvws`, `Pillow`, `websocket-client` |
| Shell launcher | `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/run.sh` | `exec python3 app.py` from script directory |
| macOS launcher | `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/Launch Frame TV Art.command` | Double-click launcher: manages port, starts server, opens browser |
| Attribution | `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/CREDITS.md` | LGPL-3.0 credit for NickWaterton and DSR! libraries |
| Git ignore | `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/.gitignore` | Excludes `uploads/`, `samsung_tv_token.txt`, `venv/`, `__pycache__/` |

## app.py Structure

The single backend file is organised into named sections separated by `# ── … ──` banner comments:

| Section | Lines | Contents |
|---|---|---|
| Imports & logging setup | 1–18 | stdlib + Flask + Pillow; `logging.basicConfig` |
| PIL protection | 20–23 | `Image.MAX_IMAGE_PIXELS = 100_000_000` |
| Flask app init | 25–42 | `BASE_DIR`, instance path, `MAX_CONTENT_LENGTH`, `UPLOAD_FOLDER`, `TOKEN_FILE` |
| Input validation helpers | 44–96 | `validate_ip`, `validate_matte_id`, `validate_content_id`, `validate_artmode_settings`, `_err` |
| Samsung TV helpers | 106–148 | `get_art()`, `with_retry()` |
| Routes | 151–429 | Eight route functions (see below) |
| `__main__` block | 432–439 | `PORT`, `FRAME_TV_HOST`, `FLASK_DEBUG` env vars; `app.run()` |

### Route inventory

| Method | Path | Function | Purpose |
|---|---|---|---|
| GET | `/` | `index()` | Serves `index.html` |
| POST | `/api/connect` | `connect()` | Test TV reachability; return art support + artmode status |
| POST | `/api/upload` | `upload()` | Accept base64 image, transcode to JPEG, upload to TV |
| GET | `/api/artworks` | `artworks()` | Fetch list of uploaded artworks from TV |
| POST | `/api/select` | `select()` | Set active artwork by content ID |
| POST | `/api/artmode` | `artmode()` | Enable or disable Art Mode |
| GET | `/api/artmode/settings` | `get_artmode_settings()` | Read Art Mode settings from TV |
| POST | `/api/artmode/settings` | `set_artmode_settings()` | Write Art Mode settings to TV |
| GET | `/api/mattes` | `get_mattes()` | Fetch supported matte types and colours from TV |

## static/js/app.js Structure

The single frontend file is organised into labelled sections separated by `/* ════ … ════ */` banner comments:

| Section | Contents |
|---|---|
| State variables (top) | `cropper`, `tvConnected`, `tvIp`, `flipX/Y`, `bulkMode`, `bulkQueue`, `colorTemp` |
| DOM refs | ~60 `getElementById` assignments grouped by feature area |
| Toast | `showToast(msg, type)` — fixed-position notification |
| API helper | `api(endpoint, method, body)` — fetch wrapper |
| Matte helpers | `formatMatteName()`, `loadMattes()` — dynamic matte dropdown |
| Ratio helper | `getSelectedRatio()` |
| Bulk mode | `bulkModeSwitch` handler, `applyBulkModeUI()`, drag-drop, `addToBulkQueue()`, `renderBulkQueue()`, `updateBulkLabel()`, `generateThumb()`, `autoCropToDataURL()`, `uploadBulk()` |
| Single crop | `loadFile()`, `initCropper()`, ratio/tool button handlers |
| Tabs | Click delegation on `#mainTabs` |
| TV connection | `connectToTV()`, `setConnectingState()`, `setConnectedState()`, `setErrorState()` |
| Art Mode tab | `setArtMode()`, shuffle/brightness/colortemp/motion/sensor handlers, fetch and save settings |
| Upload (single) | `uploadToTV()`, `showProgress()`, `setProgress()`, `showResult()` |
| My Artworks | `loadArtworks()`, `selectArtwork()` |

## static/css/style.css Structure

Sections in source order:
1. Reset & base — `*`, `html`, `body`, CSS custom properties (`:root`)
2. App shell — `.app`
3. Header — `.header`, `.header-inner`, `.logo`, `.header-badge`
4. Main layout — `.main` (CSS grid: `1fr 380px`), `.panel`
5. Upload zone — `.upload-zone`, `.upload-placeholder`, `.crop-wrapper`, `.crop-controls`
6. Cards (right panel) — `.card`, `.card-header`, `.card-body`
7. Form elements — `.field-label`, `.input`, `.select`, `.checkbox-row`
8. Buttons — `.btn-primary`, `.btn-secondary`, `.btn-ratio`, `.btn-tool`, `.btn-icon`, `.btn-send`
9. Status chip — `.status-chip`, `.status-dot` (`.connected`, `.connecting`, `.disconnected`), `@keyframes pulse`
10. Progress bar — `.progress-wrap`, `.progress-bar`, `.progress-fill`, `.progress-label`
11. Result messages — `.result-msg.success`, `.result-msg.error`
12. Alert — `.alert--info`
13. Artworks grid — `.artworks-grid`, `.artwork-item`, `.artwork-thumb`
14. Toast — `.toast`, `.toast.show`, `.toast.success`, `.toast.error`
15. Tooltips — `[data-tooltip]` pseudo-element pattern
16. Cropper overrides — `.cropper-container`, `.cropper-view-box`
17. Lucide icon sizing — per-context `svg.lucide` overrides
18. Section header / bulk toggle — `.section-header`, `.bulk-toggle-label`, `.switch`
19. Tabs — `.tabs`, `.tab-trigger`, `.tab-content`
20. Art Mode settings rows — `.setting-row`, `.setting-info`, `.setting-ctrl`, `.setting-divider`, `.setting-col`
21. Slider — `.slider`, `.slider-val`
22. Art Mode badge — `.artmode-badge`, `.artmode-badge--on`, `.artmode-badge--off`
23. Bulk queue — `.bulk-queue`, `.bulk-items`, `.bulk-item`, `.bulk-thumb`, `.bulk-item-status--*`
24. Responsive — `@media (max-width: 840px)`: single-column grid, right panel moves above left

## Naming Conventions

### Python (app.py)
- Functions: `snake_case` (`get_art`, `with_retry`, `validate_ip`)
- Private / internal helpers: leading underscore (`_err`, `_SAFE_ID_RE`, `_VALID_MOTION_TIMERS`)
- Constants: `UPPER_SNAKE_CASE` (`BASE_DIR`, `UPLOAD_FOLDER`, `TOKEN_FILE`)
- Route inner closures: `do_<verb>` (`do_upload`, `do_select`, `do_list`, `do_get`, `do_set`)

### JavaScript (app.js)
- Variables and functions: `camelCase` (`tvConnected`, `loadArtworks`, `uploadBulk`)
- DOM ref variables: named after the element ID in camelCase (`uploadZone`, `cropWrapper`, `artworksGrid`)
- Boolean state flags: plain camelCase (`tvConnected`, `bulkMode`)
- Queue items: object literals with keys `{ file, thumbUrl, name, status }`

### CSS (style.css)
- BEM-lite: block `.card`, element `.card-header`, `.card-body`
- State modifiers: double-dash suffix (`.status-dot.connected`, `.artmode-badge--on`, `.bulk-item-status--done`)
- Utility / size variants: double-dash suffix (`.select--sm`, `.btn-sm`)
- CSS custom properties: `--kebab-case` (`--bg`, `--surface`, `--accent`, `--radius`)

### HTML (index.html)
- Element IDs: camelCase for JS targets (`uploadZone`, `cropWrapper`, `cardUpload`)
- Data attributes: `data-kebab-case` (`data-tab`, `data-ratio`, `data-colortemp`, `data-sens`, `data-tooltip`)
- ARIA: standard attributes (`role="switch"`, `aria-checked`, `aria-live`)

## External Dependencies

### CDN (loaded in index.html with SRI hashes)
- **Cropper.js 1.6.1** — image crop/rotate/flip widget; CSS + JS
- **Lucide 0.575.0** — icon library (UMD bundle)

### Python (requirements.txt)
- **flask >= 3.0.0** — web framework; routing, templating, JSON responses
- **samsungtvws >= 2.6.0** — Samsung TV WebSocket client; `SamsungTVArt` class
- **Pillow >= 10.0.0** — image decoding, RGB conversion, JPEG encoding, decompression-bomb protection
- **websocket-client >= 1.6.0** — underlying WebSocket transport used by samsungtvws

## Generated / Transient Files (not committed)

| Path | Created by | Purpose |
|---|---|---|
| `uploads/upload_temp.jpg` | `upload()` route | Intermediate JPEG written before TV transfer, deleted in `finally` |
| `samsung_tv_token.txt` | `samsungtvws` on first pairing | Persists the TV's pairing token; `chmod 0o600` after each write |
| `~/.cache/frame-tv-art/` | Flask startup | Instance folder for Flask internals; `chmod 0o700` |
| `__pycache__/` | Python interpreter | Bytecode cache |
