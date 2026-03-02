# INTEGRATIONS.md — External Integrations

## Samsung Frame TV

The core and only device integration. All communication is managed by the `samsungtvws` Python library.

### Connection

- **Protocol**: Samsung Encrypted WebSocket API (`wss://`, port `8002`)
- **Library**: `samsungtvws >= 2.6.0` — specifically the `SamsungTVArt` class
- **App identifier**: `'FrameArtApp'` (sent during WebSocket handshake)
- **Pairing**: First connection triggers an on-screen pairing dialog on the TV; the user must accept. The resulting auth token is persisted to `samsung_tv_token.txt`.
- **Token file**: `<repo>/samsung_tv_token.txt` (mode `0600`, gitignored). Only `SamsungTVArt` writes to this file — the main remote-control WebSocket class (`SamsungTVWS`) is explicitly avoided to prevent token-file conflicts.

Implementation: `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/app.py`, `get_art()` function (lines 108–132)

### Art-Supported Check

- **Method**: `art.supported()` — uses Samsung REST HTTP endpoint (not WebSocket); no pairing prompt
- Called during every `/api/connect` request to determine whether the TV is a Frame model

### WebSocket Calls Made

All WebSocket calls use the `with art:` context manager (opens/closes the connection per request). Timeouts are set per operation:

| Operation                         | TV API call                              | Timeout | Route |
|-----------------------------------|------------------------------------------|---------|-------|
| Get current art mode state        | `a.get_artmode()`                        | 30 s    | `POST /api/connect` |
| Upload artwork                    | `a.upload(path, matte=…)`                | 90 s    | `POST /api/upload` |
| Display uploaded artwork          | `a.select_image(content_id, show=True)`  | within upload | `POST /api/upload` |
| List stored artworks              | `a.available()`                          | 30 s    | `GET /api/artworks` |
| Display existing artwork          | `a.select_image(content_id, show=True)`  | 20 s    | `POST /api/select` |
| Toggle art mode                   | `a.set_artmode(mode)`                    | 20 s    | `POST /api/artmode` |
| Fetch art mode settings           | `a.get_artmode_settings()`               | 20 s    | `GET /api/artmode/settings` |
| Save brightness/shuffle/timer/color | `a.set_artmode_settings(settings)`     | 20 s    | `POST /api/artmode/settings` |
| Save motion timer                 | `a.set_motion_timer(value)`              | 20 s    | `POST /api/artmode/settings` |
| Save motion sensitivity           | `a.set_motion_sensitivity(value)`        | 20 s    | `POST /api/artmode/settings` |
| Toggle auto-brightness sensor     | `a.set_brightness_sensor_setting(bool)`  | 20 s    | `POST /api/artmode/settings` |
| Fetch matte list                  | `a.get_matte_list()`                     | 20 s    | `GET /api/mattes` |

### Retry Logic

`with_retry(fn, retries=2, delay=1.5)` wraps most WebSocket calls (except the initial pairing connect). Retries on errors containing `'timeout'`, `'connection'`, or `'channel'` in the message string.

Implementation: `app.py`, `with_retry()` function (lines 135–148)

### TV Network Requirements

- TV must be on the same LAN as the host machine
- TV IP is entered manually by the user (IPv4 or IPv6 — no hostname support)
- Port 8002 must be reachable (standard Samsung Smart TV WebSocket port)

---

## CDN / Third-Party Script Delivery

The frontend loads two libraries from public CDNs. Neither sends application data externally — they are static asset deliveries only.

### Cropper.js (cdnjs.cloudflare.com)

- **URL**: `https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css` and `cropper.min.js`
- **Version**: 1.6.1
- **SRI**: Both resources are integrity-verified (`sha384-…`)
- **Purpose**: Client-side image crop, rotate, flip before upload
- **Data flow**: Purely client-side; no image data leaves the browser via Cropper.js

### Lucide Icons (unpkg.com)

- **URL**: `https://unpkg.com/lucide@0.575.0/dist/umd/lucide.min.js`
- **Version**: 0.575.0
- **SRI**: Integrity-verified (`sha384-…`)
- **Purpose**: SVG icon rendering via `lucide.createIcons()` / `data-lucide` attributes
- **Data flow**: No data transmitted; icon render is client-side

---

## Internal API (Browser → Flask)

The browser communicates with the local Flask server only. All endpoints are relative paths (`/api/…`); no cross-origin requests are made.

| Endpoint                   | Method | Payload format                  |
|----------------------------|--------|---------------------------------|
| `/api/connect`             | POST   | JSON `{ip}`                     |
| `/api/upload`              | POST   | JSON `{ip, image (base64 JPEG), matte, show}` |
| `/api/artworks`            | GET    | Query param `ip`                |
| `/api/select`              | POST   | JSON `{ip, content_id}`         |
| `/api/artmode`             | POST   | JSON `{ip, mode}`               |
| `/api/artmode/settings`    | GET    | Query param `ip`                |
| `/api/artmode/settings`    | POST   | JSON `{ip, settings: {...}}`    |
| `/api/mattes`              | GET    | Query param `ip`                |

All responses: `Content-Type: application/json`, shape `{success: bool, ...}`.

---

## Authentication / Auth Providers

**None.** There is no user authentication, sessions, or external auth provider. The app is designed for local-only use (`127.0.0.1` by default). The only credential is the Samsung TV pairing token stored in `samsung_tv_token.txt`.

---

## Webhooks / Incoming Events

None. The app is purely request-driven; it does not register webhooks, listen for TV push events, or poll any external service.

---

## Third-Party Library Attribution

From `/Users/scottwilliams/Documents/Claude Code/frame-tv-art/CREDITS.md`:

| Library | Author | License | Used for |
|---------|--------|---------|----------|
| `samsungtvws` | DSR! (xchwarze) | LGPL-3.0 | Core Samsung TV WebSocket client (`SamsungTVArt`) |
| `samsung-tv-ws-api` (fork) | NickWaterton | LGPL-3.0 | API documentation reference for `get_matte_list()`, `set_motion_timer()`, `set_motion_sensitivity()`, `set_brightness_sensor_setting()` |
