# Frame TV Art — Webapp Test Report

**Date:** 2026-03-02
**Tested by:** Claude (automated API + code review)
**Server:** Flask dev server, http://127.0.0.1:5001
**Scope:** API validation, error handling, security headers, XSS surface, JS patterns
**Not tested:** Live TV interactions (no hardware available)

---

## Summary

| Category | Result |
|----------|--------|
| All 16 BUG_BASH fixes verified | ✅ PASS |
| Input validation | ✅ PASS |
| HTTP status codes | ✅ PASS |
| XSS surface | ✅ PASS — all user data uses textContent / DOM methods |
| Object URL memory management | ✅ PASS |
| Pairing detection (client + server) | ✅ PASS |
| Security headers | ⚠️ PARTIAL — missing X-Frame-Options, CSP, X-Content-Type-Options |
| Malformed JSON error format | ⚠️ Returns HTML, not JSON |
| Favicon | ℹ️ 404 (cosmetic) |
| Server version disclosure | ℹ️ Server header exposes Werkzeug + Python versions |

---

## ✅ PASS — BUG_BASH Fixes Verified

All 16 bugs from `BUG_BASH.md` plus the pairing-loop fix from this session are confirmed
present and behaving correctly (where testable without a TV).

| # | Fix | Verified how |
|---|-----|-------------|
| 1 | `_connect()` inside try block | Code review — `execute()` wraps both connect and fn() in the same try |
| 2 | XSS via filename (bulk queue) | bulkItemsEl built with DOM methods + textContent |
| 3 | artworksGrid with server string | Error path uses textContent on a newly created span |
| 4 | `api()` non-JSON handling | Checks Content-Type before `res.json()`; throws readable error on HTML |
| 5 | 90 s timeout on all ops | `_OP_TIMEOUT=20` applied via `art.connection.settimeout()` after `open()` |
| 6 | All errors HTTP 200 | API tests confirm 400 / 401 / 502 / 413 used correctly |
| 7 | Object URL leak | `_cropObjectUrl` revoked before reassignment; bulk thumbs revoked in callbacks |
| 8 | Pairing alert on all errors | Server sets `data.pairing: true` only for auth failures; client uses that flag |
| 9 | Bulk "show after" last-item logic | Last-pending-index tracked before loop |
| 10 | Token in project dir | `TOKEN_FILE = os.path.join(_instance_path, …)` confirmed |
| 11 | IPv6 loopback accepted | `ip=::1` → HTTP 400 "Invalid IP address" |
| 12 | `display_timer` no allowlist | `display_timer=7` rejected; `display_timer=30` accepted |
| 13 | `tvIp` set before success | Moved inside `setConnectedState()` |
| 14 | Upload UI visible after reconnect fail | `setErrorState()` hides upload/artworks/artmode cards |
| 15 | Missing ARIA attributes | `aria-selected` on tabs, `aria-label` on switches |
| 16 | Content-Type on GET requests | `api()` only sets the header when `body !== null` |
| + | Stale pairing token loop | Token file cleared on UNAUTHORIZED with no new token |

---

## ⚠️ FINDINGS

### F-1 · Missing HTTP Security Headers
**Severity:** Low (localhost-only by default; higher if LAN mode is used)

The server returns no security headers beyond `Content-Type`:

```
Server: Werkzeug/3.1.6 Python/3.9.6   ← version disclosure
# Missing:
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'self'
```

When `FRAME_TV_HOST=0.0.0.0` is used for LAN access, a crafted page on the local
network could iframe the app or trigger MIME-sniffing behaviour.

**Recommended fix** — add an `after_request` hook in `app.py`:

```python
@app.after_request
def set_security_headers(resp):
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Content-Security-Policy"] = "default-src 'self'"
    return resp
```

---

### F-2 · Malformed JSON Request Returns HTML 400, Not JSON
**Severity:** Low

`POST /api/connect` with `Content-Type: application/json` and an invalid body
returns Flask's default HTML 400 page, not a JSON error:

```
HTTP/1.1 400 Bad Request
Content-Type: text/html; charset=utf-8
<!doctype html>…Bad Request…
```

The JS `api()` helper catches this (checks Content-Type first, throws
`Error("Server error (HTTP 400)")`), so the app does not crash — but the user
sees a generic message instead of something actionable.

**Recommended fix** — register a JSON error handler for 400 alongside the existing 413 one:

```python
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'success': False, 'error': 'Malformed request'}), 400
```

---

### F-3 · Server Version Disclosure
**Severity:** Informational

`Server: Werkzeug/3.1.6 Python/3.9.6` is sent on every response. Not directly
exploitable but aids fingerprinting if the port is ever exposed beyond localhost.

Production WSGI deployment (gunicorn, uWSGI) suppresses this automatically.
For dev use, the `after_request` hook in F-1 can also overwrite this header:

```python
resp.headers["Server"] = "FrameArtApp"
```

---

### F-4 · Favicon Missing (404)
**Severity:** Cosmetic

`GET /favicon.ico` → HTTP 404. Every browser tab load generates a 404 log line
and shows the browser's default icon.

**Fix** — add a favicon to `static/` and register a route:

```python
from flask import send_from_directory

@app.route('/favicon.ico')
def favicon():
    return send_from_directory('static', 'favicon.ico')
```

---

### F-5 · `brightness` API Range (1–10) vs Samsung Convention
**Severity:** Informational

Server validates `1 <= brightness <= 10`; the HTML slider matches (`min=1 max=10`).
Samsung Frame TV firmware documentation typically describes brightness in a 0–100
range for the art channel API. If a samsungtvws update or firmware change expects
0–100, both the slider and validation would silently send the wrong values.

Could not be confirmed without a live TV. Worth a comment near the validation.

---

## ℹ️ OBSERVATIONS (Not Bugs)

- **Static icon markup written via `.innerHTML`** (app.js lines 655, 661, 701):
  `fetchSettingsBtn.innerHTML = '<i data-lucide="loader-2"></i>…'` — these are
  developer-controlled constants with no user data, so there is no XSS risk.
  Minor inconsistency with the "use DOM methods" pattern used everywhere else.

- **`settings` nesting in POST body**: `/api/artmode/settings` expects
  `{"ip":"…", "settings": {"brightness": 5}}`. Sending a flat payload like
  `{"ip":"…", "brightness": 5}` returns "No settings provided" rather than
  a hint about the expected structure. "settings object is required" would aid debugging.

- **No rate limiting on `/api/connect`**: Rapid calls with arbitrary IPs are accepted.
  Negligible risk at localhost; worth noting if LAN mode becomes a primary use case.

---

## Test Commands Reference

```bash
BASE=http://127.0.0.1:5001

# Validation — IP checks
curl -s -X POST $BASE/api/connect -H "Content-Type: application/json" -d '{"ip":"::1"}'
# → {"error":"Invalid IP address","success":false}  HTTP 400

curl -s -X POST $BASE/api/connect -H "Content-Type: application/json" -d '{"ip":"127.0.0.1"}'
# → {"error":"Invalid IP address","success":false}  HTTP 400

# Method not allowed
curl -s -o /dev/null -w "%{http_code}" $BASE/api/connect          # 405
curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/artworks # 405

# 413 handling (101 MB body → JSON response)
python3 -c "
import http.client
conn = http.client.HTTPConnection('127.0.0.1', 5001, timeout=10)
conn.request('POST', '/api/upload', b'A'*(101*1024*1024), {'Content-Type':'application/json'})
r = conn.getresponse()
print(r.status, r.read(100))
"
# → 413 b'{"error":"Image file too large (max 100 MB)","success":false}'

# Malformed JSON → HTML 400  (F-2 finding)
curl -s -X POST $BASE/api/connect -H "Content-Type: application/json" -d 'not json'

# display_timer allowlist
curl -s -X POST $BASE/api/artmode/settings -H "Content-Type: application/json" \
  -d '{"ip":"192.168.1.100","settings":{"display_timer":7}}'
# → display_timer must be one of: 1, 3, 5, 10, 15, 30, 60, 180, 720, 1440

# Security headers check
curl -sI $BASE/ | grep -E "Server|X-Frame|X-Content|Content-Security"
# → Only Server: Werkzeug/3.1.6 Python/3.9.6 (F-1 finding)
```
