# Code Conventions

Codebase: `/Users/scottwilliams/Documents/Claude Code/frame-tv-art`
Stack: Python (Flask) backend, vanilla JavaScript frontend, Jinja2 HTML templates, plain CSS.

---

## Python (`app.py`)

### Imports

Standard library imports come first, grouped by purpose, followed by third-party imports.
The `samsungtvws` library is imported lazily inside `get_art()` to produce a clear, actionable error message if the package is missing rather than crashing on startup.

```python
# Standard library
import os, re, base64, json, time, ipaddress, logging
from io import BytesIO

# Third-party
from flask import Flask, render_template, request, jsonify
from PIL import Image

# Lazy / conditional
from samsungtvws import SamsungTVArt  # imported inside get_art()
```

### Naming

| Construct | Convention | Example |
|-----------|-----------|---------|
| Functions | `snake_case` | `validate_ip`, `get_art`, `with_retry` |
| Variables | `snake_case` | `content_id`, `show_after`, `temp_path` |
| Module-level constants | `UPPER_SNAKE_CASE` | `UPLOAD_FOLDER`, `TOKEN_FILE` |
| Private module constants | `_leading_underscore` | `_SAFE_ID_RE`, `_VALID_MOTION_TIMERS`, `_instance_path` |
| Flask app object | `app` (conventional) | — |
| Logger | `logger = logging.getLogger(__name__)` | — |

### Section Separators

Major logical sections within `app.py` are separated by ruled banner comments using unicode box-drawing characters. This makes navigation easy in editors without a symbol browser.

```python
# ── Logging ──────────────────────────────────────────────────────────────────
# ── PIL decompression-bomb protection ────────────────────────────────────────
# ── Input validation helpers ─────────────────────────────────────────────────
# ── Samsung TV helpers ────────────────────────────────────────────────────────
# ── Routes ────────────────────────────────────────────────────────────────────
```

### Error Handling

All routes use a single private helper to construct error responses:

```python
def _err(msg: str, exc=None) -> dict:
    """Log exc internally; return a sanitised JSON-safe error dict."""
    if exc is not None:
        logger.error('%s: %s', msg, exc)
    return {'success': False, 'error': msg}
```

Key properties of this pattern:
- Exception details are logged server-side but never sent to the client (prevents information leakage).
- The user-facing `error` string is always a human-readable literal, never `str(exc)`.
- All successful API responses include `{'success': True, ...}`.
- Every route wraps its TV call in `try/except Exception` and returns `jsonify(_err(..., e))`.

Non-fatal operations (e.g. `select_image` after upload, fetching artmode on connect) are wrapped in their own inner `try/except` and silently swallowed:

```python
try:
    a.select_image(content_id, show=True)
except Exception:
    pass  # display failure is non-fatal
```

### Input Validation

All external inputs are validated before use. Validators are pure functions that return `bool` or a `list[str]` of error messages.

```python
def validate_ip(ip_str: str) -> bool: ...
def validate_matte_id(matte: str) -> bool: ...
def validate_content_id(cid: str) -> bool: ...
def validate_artmode_settings(s: dict) -> list: ...
```

Allowed-value sets for enum-like fields use module-level `frozenset`-style assignments:

```python
_VALID_MOTION_TIMERS = {'off', '5', '15', '30', '60', '120', '240'}
_VALID_MOTION_SENS   = {'1', '2', '3'}
_VALID_COLOR_TEMPS   = {'cool', 'natural', 'warm1', 'warm2'}
_VALID_ARTMODE_MODES = {'on', 'off'}
```

### Retry Logic

Network calls to the TV go through a shared `with_retry` helper rather than inline loops. Retries are limited to connection/timeout errors; other exceptions propagate immediately.

```python
def with_retry(fn, retries=2, delay=1.5):
    """Call fn(), retrying on TV connection/timeout errors."""
```

Routes define a `do_*` inner function and pass it to `with_retry`:

```python
def do_upload():
    a = get_art(ip, timeout=90)
    with a:
        content_id = a.upload(temp_path, matte=matte)
        ...

content_id = with_retry(do_upload)
```

### Resource Management

TV connections use the context manager protocol (`with a:`). Temporary files are always cleaned up in `finally` blocks:

```python
finally:
    if os.path.exists(temp_path):
        os.remove(temp_path)
```

File permissions for security-sensitive files are set explicitly:

```python
os.makedirs(_instance_path, mode=0o700, exist_ok=True)
os.chmod(TOKEN_FILE, 0o600)
```

### Type Annotations

Used selectively on validator/helper functions that have non-obvious signatures:

```python
def validate_ip(ip_str: str) -> bool: ...
def validate_artmode_settings(s: dict) -> list: ...
def _err(msg: str, exc=None) -> dict: ...
```

Route functions and internal closures are left unannotated.

### Logging

Uses the standard `logging` module. One module-level logger:

```python
logger = logging.getLogger(__name__)
```

Format: `%(asctime)s  %(levelname)-8s  %(message)s` with time-only `%H:%M:%S`.
`logger.info` for startup; `logger.error` for all caught exceptions (inside `_err`).
`FLASK_DEBUG` must be explicitly set to `'1'` to enable debug mode; it defaults to off.

### Commenting Style

- Module-level banner comments explain the *why* for non-obvious configuration choices.
- Inline comments explain intent at the call site, especially for TV-specific quirks.
- Docstrings on public helpers use one-sentence summaries followed by prose paragraphs when the reasoning is complex.

```python
def get_art(ip, timeout=10):
    """Return a SamsungTVArt instance connected directly to the art-app endpoint.

    Using SamsungTVArt directly (instead of SamsungTVWS.art()) avoids the
    token-file conflict where the main remote-control WebSocket and the art-app
    WebSocket overwrite each other's tokens on every request...
    """
```

---

## JavaScript (`static/js/app.js`)

### Structure

The file is organized into sections separated by thick banner comments using box-drawing characters, mirroring the Python style:

```js
/* ── State ── */
/* ── Boot ── */
/* ── DOM refs ── */
/* ── Toast ── */
/* ── API helper ── */
/* ════════════════════════════════════════
   BULK MODE
   ════════════════════════════════════════ */
/* ════════════════════════════════════════
   TV CONNECTION
   ════════════════════════════════════════ */
```

Major feature sections (BULK MODE, BULK QUEUE, TABS, TV CONNECTION, ART MODE TAB, UPLOAD, MY ARTWORKS) use the double-bar `════` style. Minor sections use the single-bar `──` style.

### Naming

| Construct | Convention | Example |
|-----------|-----------|---------|
| Variables / state | `camelCase` | `tvConnected`, `bulkQueue`, `colorTemp` |
| Functions | `camelCase` | `loadMattes`, `connectToTV`, `uploadBulk` |
| DOM references | `camelCase` with `El` suffix for collection elements | `bulkItemsEl`, `bulkQueueEl` |
| Constants (sets/maps) | Object literals or inline | `{ pending: 'circle', uploading: 'loader', ... }` |

### Module Pattern

No module bundler or ES modules are used. The entire frontend is a single IIFE-free script with global state. Global variables are declared at the top of the file with `let`:

```js
let cropper = null;
let tvConnected = false;
let tvIp = '';
let flipX = 1, flipY = 1;
let bulkMode = false;
let bulkQueue = [];
let colorTemp = 'natural';
```

DOM references are cached into `const` variables immediately after the state block, using `document.getElementById`.

### Async / Error Handling

All TV API calls use `async/await`. A shared thin wrapper handles JSON fetch:

```js
async function api(endpoint, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(endpoint, opts);
  return res.json();
}
```

Each caller wraps the `api()` call in `try/catch`. Network errors display a toast; API-level errors (`data.success === false`) show an inline result message and a toast. Non-fatal failures use empty `catch` blocks with a comment:

```js
} catch {
  // Non-fatal — keep existing options
}
```

### DOM Manipulation for Security

When inserting TV-sourced data (content IDs), the code uses `textContent` and `setAttribute` rather than `innerHTML` to prevent XSS:

```js
// Use textContent / setAttribute — never innerHTML — with TV-sourced data
div.setAttribute('title', `ID: ${id}\nClick to display on TV`);
label.textContent = id.slice(-8) || 'art';
```

Internally-generated HTML (bulk queue items, fixed-structure templates) does use `innerHTML` with template literals, but only with values from `bulkQueue` which originates from local file objects.

### State / UI Sync

Connection state is managed by three functions that encapsulate all visual side-effects:

```js
function setConnectingState() { ... }
function setConnectedState(data) { ... }
function setErrorState(msg) { ... }
```

### Event Delegation

Button groups use delegated click listeners on the parent element with `.closest()`:

```js
ratioGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-ratio');
  if (!btn) return;
  ...
});
```

---

## CSS (`static/css/style.css`)

### Variables

All design tokens are defined as CSS custom properties on `:root`:

```css
:root {
  --bg, --surface, --surface2        /* layered backgrounds */
  --border, --border2                /* border tones */
  --accent, --accent-dk              /* primary interactive color */
  --text, --muted                    /* typography */
  --success, --error, --warn         /* semantic feedback */
  --radius, --radius-sm              /* border radius scale */
  --shadow                           /* elevation */
}
```

### Naming

BEM-adjacent: block `card`, elements `card-header` / `card-body`, modifiers with `--` suffix: `card--sm`, `artmode-badge--on`, `bulk-item-status--uploading`.

Component classes use kebab-case throughout: `.upload-zone`, `.crop-wrapper`, `.setting-row`.

### Section Separators

Same banner pattern as the JS file:

```css
/* ── Reset & Base ── */
/* ── App shell ── */
/* ── Header ── */
/* ── Cards (right panel) ── */
/* ── Responsive ── */
```

### Responsive Design

A single breakpoint at `840px` stacks the two-column grid to a single column and moves the right panel above the image panel:

```css
@media (max-width: 840px) {
  .main { grid-template-columns: 1fr; padding: 16px; }
  .panel--right { order: -1; }
}
```

---

## HTML (`templates/index.html`)

- Jinja2 template with Flask's `url_for` for asset URLs (cache-busting friendly).
- CDN scripts use `integrity` (SRI hashes) and `crossorigin="anonymous"` on all external resources.
- `role="switch"` / `aria-checked` on toggle buttons for accessibility.
- `role="tablist"` / `role="tab"` on the tab bar.
- Inline `style="display:none"` is used to hide elements that JS shows conditionally, avoiding a flash of unstyled content.
- HTML comments use `<!-- ── Section name ── -->` to mirror the JS/CSS banner style.

---

## Project Layout

```
frame-tv-art/
  app.py                         # Flask server, all routes and helpers
  requirements.txt               # Pinned with >= lower bounds only
  run.sh                         # Minimal: cd + exec python3 app.py
  Launch Frame TV Art.command    # macOS double-click launcher (zsh)
  CREDITS.md                     # Third-party attribution (LGPL)
  static/
    css/style.css
    js/app.js
  templates/
    index.html
  uploads/                       # Gitignored temp directory
  samsung_tv_token.txt           # Gitignored pairing token
```

Single-file backend (no blueprints, no packages). All application logic lives in `app.py`.

---

## Security Conventions

- IP addresses validated with `ipaddress.ip_address()` — no hostname resolution, prevents SSRF.
- Content IDs and matte IDs validated against `^[A-Za-z0-9_\-]+$`.
- PIL `MAX_IMAGE_PIXELS` capped at 100 MP; `DecompressionBombError` caught explicitly.
- Flask `MAX_CONTENT_LENGTH` set to 100 MB.
- Token file permissions set to `0o600`; instance directory to `0o700`.
- Debug mode off by default; requires `FLASK_DEBUG=1` env var.
- Server binds to `127.0.0.1` by default; `FRAME_TV_HOST=0.0.0.0` opt-in for LAN access.
