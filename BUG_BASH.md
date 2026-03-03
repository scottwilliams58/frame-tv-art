# Bug Bash Report — Frame TV Art Uploader

**Date:** 2026-03-02
**Files reviewed:** `app.py`, `static/js/app.js`, `templates/index.html`, `static/css/style.css`

---

## Severity Legend

| Level | Meaning |
|-------|---------|
| 🔴 High | Will silently misbehave or cause a real failure path |
| 🟡 Medium | Bad practice, potential future breakage, or confusing UX |
| 🟢 Low | Minor, edge-case, or cosmetic |

---

## 🔴 High

### 1. `_connect()` failure is not retried — `app.py:141`

```python
for attempt in range(2):
    if self._art is None or not self._art.is_alive():
        self._connect(ip)   # ← OUTSIDE the try block
    try:
        return fn(self._art)
    except Exception as e:
        ...
        if attempt == 0 and retriable:
            continue
        raise
```

`_connect()` is called **before** the `try/except`. If the TV refuses the WebSocket during the first connection attempt (e.g. busy, wrong port, first-time pairing timeout), the exception propagates straight out of `execute()` — the retry loop never fires. Only failures **inside `fn()`** get retried.

**Fix:** Wrap `_connect()` in its own try/except, or restructure the loop so connection errors also benefit from the retry.

---

### 2. XSS via filename in bulk queue — `app.js:308`

```javascript
el.innerHTML = `
  <img class="bulk-thumb" src="${item.thumbUrl}" alt="" />
  <div class="bulk-item-info">
    <span class="bulk-item-name">${item.name}</span>   ← unescaped
    ...`;
```

`item.name` is `file.name` from the OS file picker. A file named `<img src=x onerror=alert(1)>.jpg` would execute arbitrary JS. For a localhost-only tool the attacker is the user themselves, but it's still a real code path that breaks if you ever drag in a file from an untrusted source (shared folder, download, etc.).

**Fix:** Build the element with `createElement` / `textContent` the same way `loadArtworks()` already does.

---

## 🟡 Medium

### 3. `artworksGrid.innerHTML` with server-sourced string — `app.js:739`

```javascript
if (!data.success) {
    artworksGrid.innerHTML = `<span class="muted">${data.error}</span>`;
    return;
}
```

`data.error` is injected into `innerHTML`. The server's `_err()` returns hardcoded strings, so the risk is low today, but any future change that echoes TV-sourced data through an error message would immediately become XSS.

**Fix:** `artworksGrid.textContent = ''` then append a `<span>` with `textContent`.

---

### 4. `api()` doesn't handle non-JSON error responses — `app.js:89`

```javascript
const res = await fetch(endpoint, opts);
return res.json();   // throws if body isn't JSON
```

Flask returns HTML for unhandled errors and for `413 Request Entity Too Large` (when `MAX_CONTENT_LENGTH` is exceeded). `res.json()` will throw, callers catch it, but the error message shown to the user is a cryptic JS parse error rather than "image too large".

**Fix:** Check `res.ok` / `res.status` and `Content-Type` before calling `res.json()`.

---

### 5. 90-second timeout applied to ALL TV operations — `app.py:168–174`

```python
art = SamsungTVArt(..., timeout=_CONNECT_TIMEOUT)   # 90 s
```

`timeout` is the socket recv timeout. Once the connection is established, every subsequent command — `set_artmode()`, `select_image()`, `get_artmode_settings()` — also waits up to 90 seconds for a response. A hung TV would block the Flask thread for 90 s and leave the UI frozen.

**Fix:** Use a shorter operational timeout (e.g. 15 s) for post-connect calls. The 90 s is only needed during `open()` to cover the pairing dialog. Consider creating the `SamsungTVArt` instance with the long timeout for `open()`, then updating `self._art.timeout` to a shorter value afterwards.

---

### 6. All error responses return HTTP 200 — `app.py` (all routes)

```python
return jsonify(_err('Invalid IP address'))   # HTTP 200 ← should be 400
return jsonify(_err('Upload to TV failed', e))  # HTTP 200 ← should be 500
```

Every error response — including validation failures that should be 400, and server-side failures that should be 500 — returns HTTP 200. This makes it impossible to distinguish failures from successes in browser dev tools, logging, or future callers.

**Fix:** Add status codes: `jsonify(_err(...)), 400` for validation and `jsonify(_err(...)), 502` for TV communication failures.

---

### 7. Object URL leak in single-image mode — `app.js:222`

```javascript
function loadFile(file) {
    cropImage.src = URL.createObjectURL(file);   // never revoked
    ...
}
```

Every time the user loads an image, a new `blob:` URL is created and never freed. When "Change Image" is clicked, the old URL is simply overwritten, not revoked. On long sessions with many image loads, memory accumulates.

**Fix:** Store the previous URL and call `URL.revokeObjectURL(prev)` before assigning a new one.

---

### 8. Pairing alert shown for all connection errors — `app.js:457`

```javascript
const isFirst = /token|pair|connect|refused/i.test(data.error || '');
```

The word `"connect"` appears in the generic server error `"Could not connect to TV"`, which means the pairing alert pops up for any connection failure (TV off, wrong IP, network issue) — not just actual first-time pairing situations. Users see "Check your TV for a pairing dialog" when the TV is simply unreachable.

**Fix:** Use a more specific regex (`/token|pair|unauthorized|denied/i`) and have the server return a typed error code for pairing vs. general connection failure.

---

## 🟢 Low

### 9. Bulk upload "show after" logic broken when last item is already done — `app.js:396–410`

```javascript
for (let i = 0; i < bulkQueue.length; i++) {
    const item = bulkQueue[i];
    if (item.status === 'done') continue;   // ← skips item
    ...
    show: show && i === bulkQueue.length - 1,   // ← index still compared to full length
}
```

If the last item in the queue is already `'done'` from a previous run, it's skipped — so the `show` flag is never true for any upload. Additionally, if the last item fails, no artwork is displayed on the TV even though previous items succeeded.

**Fix:** Track the last *pending* item's index before the loop starts, use that for the `show` comparison, and only pass `show: true` if that last item actually succeeded.

---

### 10. Token file stored next to `app.py`, not in `instance_path` — `app.py:42`

```python
TOKEN_FILE = os.path.join(BASE_DIR, 'samsung_tv_token.txt')
```

The secure `instance_path` (`~/.cache/frame-tv-art`, mode 0700) was set up for exactly this purpose but isn't used for the token. The token ends up in the project directory, which may be in a git repo or a shared/world-readable location.

**Fix:** `TOKEN_FILE = os.path.join(_instance_path, 'samsung_tv_token.txt')`.

---

### 11. `validate_ip()` accepts IPv6 loopback — `app.py:50`

```python
ipaddress.ip_address('::1')   # valid — passes validation
```

`::1` (IPv6 localhost) and `::ffff:127.0.0.1` (IPv4-mapped) pass `ip_address()` validation. A request with `ip=::1` would have the server try to connect to itself, hitting whatever is on port 8002 locally.

**Fix:** After parsing, check `addr.is_loopback or addr.is_link_local or addr.is_multicast` and reject those.

---

### 12. `display_timer` has no range or allowlist check — `app.py:83`

```python
if 'display_timer' in s:
    try:
        int(s['display_timer'])   # accepts 0, -1, 99999
    except (TypeError, ValueError):
        errors.append('display_timer must be an integer')
```

Any integer is accepted. The HTML select only offers valid values, but the API endpoint accepts any int. The TV presumably rejects invalid values gracefully, but the validation is inconsistent with the stricter treatment of `motion_timer`.

**Fix:** Add an allowlist matching the HTML options: `{1, 3, 5, 10, 15, 30, 60, 180, 720, 1440}`.

---

### 13. `tvIp` set before connection succeeds — `app.js:449`

```javascript
tvIp = ip;             // set immediately
setConnectingState();
...
if (!data.success) {
    setErrorState(...);   // tvConnected = false, but tvIp = new IP
    return;
}
```

If connection fails, `tvIp` holds the new (unreachable) IP while `tvConnected` is false. All guarded code paths check `tvConnected`, so no actual API calls fire. But if the user was previously connected to IP A and retries with IP B (which fails), `tvIp` is now B. If `tvConnected` check is ever missed in a new code path, it would silently call the wrong IP.

**Fix:** Only update `tvIp` on success: move `tvIp = ip` inside `setConnectedState()`.

---

### 14. Reconnect failure doesn't hide upload UI — `app.js:506`

If you were connected, then click "Reconnect" and it fails, `tvConnected` becomes false but the upload card, artworks grid, and Art Mode cards remain visible. Clicking Upload shows a toast error, so it's not broken — just visually misleading. Users may be confused why the UI shows artwork but can't interact with the TV.

**Fix:** In `setErrorState()`, hide `cardUpload`, `cardArtworks`, and the Art Mode cards, mirroring `setConnectedState()`.

---

### 15. Missing ARIA attributes on tab and switch components — `index.html`

- `role="tab"` buttons don't set `aria-selected` when activated (only a CSS class changes).
- `role="switch"` buttons (bulkModeSwitch, shuffleSwitch, brightnessSensorSwitch) have no `aria-label`. Screen readers announce "switch" with no context.
- The `role="tablist"` container has no `aria-label`.

**Fix:** Add `aria-selected="true/false"` in the tab click handler; add `aria-label` to each switch.

---

### 16. `api()` sends `Content-Type: application/json` on GET requests — `app.js:90`

```javascript
const opts = { method, headers: { 'Content-Type': 'application/json' } };
```

`Content-Type` describes the *request body*. GET requests have no body, so this header is technically incorrect (though harmless for Flask).

**Fix:** Only add `Content-Type` when `body` is non-null.

---

## Summary Table

| # | File | Severity | Summary |
|---|------|----------|---------|
| 1 | app.py:141 | 🔴 | `_connect()` failure skips retry loop |
| 2 | app.js:308 | 🔴 | XSS via filename in bulk queue innerHTML |
| 3 | app.js:739 | 🟡 | `artworksGrid.innerHTML` with server string |
| 4 | app.js:89 | 🟡 | `api()` throws on non-JSON (413, 500) responses |
| 5 | app.py:168 | 🟡 | 90 s timeout applies to all TV ops, not just connect |
| 6 | app.py (all routes) | 🟡 | All errors return HTTP 200 |
| 7 | app.js:222 | 🟡 | Object URL leaked on each image load |
| 8 | app.js:457 | 🟡 | Pairing alert shown for all connection errors |
| 9 | app.js:396 | 🟢 | Bulk "show after" logic broken for skipped/failed last item |
| 10 | app.py:42 | 🟢 | Token file in project dir, not secure instance_path |
| 11 | app.py:50 | 🟢 | IPv6 loopback accepted as TV IP |
| 12 | app.py:83 | 🟢 | `display_timer` has no range/allowlist check |
| 13 | app.js:449 | 🟢 | `tvIp` set before connection success |
| 14 | app.js:506 | 🟢 | Upload UI stays visible after reconnect failure |
| 15 | index.html | 🟢 | Missing ARIA attributes on tab/switch components |
| 16 | app.js:90 | 🟢 | `Content-Type` sent on GET requests |
