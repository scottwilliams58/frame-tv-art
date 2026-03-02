# Codebase Concerns

Technical debt, potential bugs, security issues, performance concerns, and fragile areas in `frame-tv-art`.

---

## 1. Race Condition: Shared Temp File

**File:** `app.py` lines 221–246
**Severity:** High (data corruption under concurrent use)

The upload route writes all incoming images to a single fixed path:

```python
temp_path = os.path.join(UPLOAD_FOLDER, 'upload_temp.jpg')
img.save(temp_path, 'JPEG', quality=95, optimize=True)
```

Flask runs with `threaded=True` (`app.py` line 439). If two upload requests arrive simultaneously, both threads write to and read from the same `upload_temp.jpg` file. One request will upload the other's image to the TV. The `finally` block may also delete the file before the other thread has finished using it.

**Fix:** Use `tempfile.NamedTemporaryFile` or `tempfile.mkstemp` so each request gets a unique path.

---

## 2. No Rate Limiting on Any Endpoint

**File:** `app.py` — all routes
**Severity:** Medium

There is no rate limiting on any of the API endpoints (`/api/connect`, `/api/upload`, `/api/artworks`, etc.). Although the server defaults to `127.0.0.1`, the launcher comment explicitly notes that `FRAME_TV_HOST=0.0.0.0` is a supported configuration for LAN use. On a shared LAN, any host could trigger large numbers of TV WebSocket connections or bulk image uploads without restriction.

**Fix:** Add `flask-limiter` (or equivalent) with per-IP rate caps on all `/api/*` routes.

---

## 3. No CSRF Protection

**File:** `app.py` — all POST routes
**Severity:** Medium

None of the POST routes validate a CSRF token. Any page loaded in the same browser can issue `fetch('/api/upload', { method:'POST', ... })` with the user's cookies/session if any future authentication is added, or can already trigger TV state changes if the server is reachable. Flask-WTF CSRF or a custom token header check would close this.

---

## 4. Bare `except` Swallows All Errors Silently

**File:** `app.py` lines 181, 236, 346; `static/js/app.js` lines 140–142, 413, 534, 621, 659, 766, 775
**Severity:** Medium (debugging / reliability)

Several bare or overly-broad exception handlers discard the exception entirely:

```python
# app.py:181 — artmode fetch on connect, exception silently becomes 'unknown'
except Exception:
    artmode = 'unknown'

# app.py:236 — select_image failure after upload is silently dropped
except Exception:
    pass  # display failure is non-fatal

# app.py:346 — JSON decode failure in get_artmode_settings silently ignored
except (json.JSONDecodeError, KeyError):
    pass
```

In JavaScript:

```js
// app.js:140–142 — matte load failure logged nowhere
} catch {
  // Non-fatal — keep existing options
}

// app.js:413 — bulk upload item error, no logging
} catch { item.status = 'error'; }
```

Silent swallowing makes diagnosing TV compatibility issues harder. At minimum, the Python handlers should call `logger.debug(...)` on the caught exception.

---

## 5. `display_timer` Not Range-Validated on Backend

**File:** `app.py` lines 81–85
**Severity:** Low–Medium

`validate_artmode_settings` confirms `display_timer` is parseable as an integer but does not constrain its value to the set offered by the UI (`{1, 3, 5, 10, 15, 30, 60, 180, 720, 1440}`). An arbitrary large or negative integer is passed through to `a.set_artmode_settings()`. The TV may accept or silently ignore out-of-range values, or it may behave unexpectedly.

---

## 6. `samsungtvws` Version Constraint Is Too Loose

**File:** `requirements.txt` line 2
**Severity:** Medium

```
samsungtvws>=2.6.0
```

The codebase already documents one breaking API change between major versions:

```python
# app.py:230
# samsungtvws >= 3.x removed the 'show' kwarg from upload().
```

An unbounded `>=` constraint means `pip install` can silently pull in future major versions that introduce further breaking changes. A pinned upper bound (`>=2.6.0,<4`) or exact lock file would make behaviour predictable.

---

## 7. No `requirements.txt` Lock File / Reproducible Environment

**File:** `requirements.txt`
**Severity:** Low–Medium

All four dependencies use only minimum version bounds with no maximum and no lock file (`pip freeze` output or `pip-tools`-generated `requirements.lock`). This makes the environment non-reproducible across machines or over time and could introduce silent regressions when upstream packages release new versions.

---

## 8. Token File Stored Next to Source Code

**File:** `app.py` lines 40–41, 130–131
**Severity:** Low–Medium

```python
TOKEN_FILE = os.path.join(BASE_DIR, 'samsung_tv_token.txt')
```

The Samsung pairing token is written to the same directory as the source code. Although `samsung_tv_token.txt` is in `.gitignore`, keeping secrets adjacent to source increases the risk of accidental exposure (e.g., copying the project folder, archiving, or a future `.gitignore` misconfiguration). The token is read-protected (`chmod 0o600`) only after the first write, not at creation time.

**Fix:** Store the token under `~/.config/frame-tv-art/` or `~/.cache/frame-tv-art/` (the instance path used for Flask is already set to `~/.cache/frame-tv-art`). Apply `chmod 0o600` immediately after creating the file, before writing credentials.

---

## 9. XSS Risk: `data.error` Interpolated Directly into `innerHTML`

**File:** `static/js/app.js` line 739
**Severity:** Low (localhost only) / Medium (if LAN-exposed)

```js
if (!data.success) {
  artworksGrid.innerHTML = `<span class="muted">${data.error}</span>`;
  return;
}
```

The server-side `_err()` helper returns sanitised messages, but if a future refactor or library update causes `data.error` to contain TV-sourced or user-influenced content, this `innerHTML` interpolation would allow script injection. All other artwork-rendering code in the same function correctly uses `textContent` and `setAttribute`. This one path should follow the same pattern.

---

## 10. Bulk Upload Skips Already-Done Items but Not Already-Errored Items

**File:** `static/js/app.js` lines 396–415
**Severity:** Low (UX bug)

```js
if (item.status === 'done') continue;
```

The bulk upload loop skips items already marked `done` (allowing resume), but does not skip items marked `error`. Re-clicking "Upload" after a partial failure re-attempts all pending and all errored items, which is generally desirable, but the count displayed in the toast (`${successCount} of ${all}`) uses `all = bulkQueue.length` rather than the number actually attempted. If some items were already `done` from a prior run, the "X of N" message misrepresents the outcome.

---

## 11. `pairingAlert` Heuristic Is Fragile

**File:** `static/js/app.js` lines 457–459
**Severity:** Low

```js
const isFirst = /token|pair|connect|refused/i.test(data.error || '');
pairingAlert.style.display = isFirst ? 'block' : 'none';
```

The pairing-dialog hint is shown based on a regex match against the error string. Because error messages are sourced from the `samsungtvws` library and the underlying WebSocket stack, any change in library error wording will silently break this detection, potentially hiding the pairing hint from new users who need it most.

---

## 12. Launcher Script Uses `kill -9` Without Cleanup

**File:** `Launch Frame TV Art.command` lines 14–17
**Severity:** Low

```zsh
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null
```

`SIGKILL` prevents the existing Flask process from running `atexit` handlers, releasing file locks, or completing in-flight uploads. Any concurrent TV upload in progress at the time of re-launch will be silently aborted mid-transfer. A graceful `SIGTERM` with a short wait before falling back to `SIGKILL` would be safer.

---

## 13. `loadMattes()` and `loadArtworks()` Have No Loading State

**File:** `static/js/app.js` lines 105–143, 734–766
**Severity:** Low (UX)

`loadMattes()` fetches from `/api/mattes` silently with no loading indicator, spinner, or error feedback to the user. If the matte fetch fails (common on first connection attempts), the dropdown silently stays with only the default "None" option and the user receives no indication that dynamic mattes are unavailable.

`loadArtworks()` does show a "Loading…" placeholder but the error path (`catch`) sets the grid to "Failed to load." with no retry affordance.

---

## 14. No Input Length Limits on IP Field

**File:** `templates/index.html` line 110; `static/js/app.js` lines 447–449
**Severity:** Very Low

The IP address `<input>` has no `maxlength` attribute. While the backend validates the value with `ipaddress.ip_address()`, an arbitrarily long string can still be sent as the `ip` payload by any client, making it easy to send unnecessarily large request bodies that are still valid JSON.

---

## 15. `Upload_folder` Permissions Not Restricted at Creation

**File:** `app.py` line 42
**Severity:** Low

```python
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
```

`os.makedirs` uses the process umask. On a typical macOS system this results in `755` (world-readable). The `uploads/` directory holds the transient `upload_temp.jpg` file during processing. Although the temp file is deleted immediately after upload, the directory is readable by any local user during the write window. Using `os.makedirs(UPLOAD_FOLDER, mode=0o700, exist_ok=True)` would restrict access.

---

## 16. Header Badge Hardcodes "Samsung Frame 2024"

**File:** `templates/index.html` line 26
**Severity:** Very Low (maintenance debt)

```html
<div class="header-badge">Samsung Frame 2024</div>
```

This will silently become inaccurate as the project is used with future TV generations. It should either be made dynamic or removed.

---

## 17. No Automated Tests

**Severity:** Medium (maintenance debt)

There are no test files, test directories, or test framework dependencies anywhere in the project. The validation helpers (`validate_ip`, `validate_matte_id`, `validate_content_id`, `validate_artmode_settings`) and the response-normalisation logic in `get_artmode_settings` are well-suited for unit tests. Without them, regressions in input validation or TV response parsing are only caught manually.

---

## 18. Cropper.js `replace()` Leaks the Original Blob URL

**File:** `static/js/app.js` line 271
**Severity:** Very Low (minor memory leak)

```js
cropper.replace(cropImage.src);
```

When `loadFile()` is called, `cropImage.src` is set to a `blob:` URL created by `URL.createObjectURL(file)`. The reset handler calls `cropper.replace(cropImage.src)` which re-renders from that blob URL — but the original blob URL is never revoked. For a single-image session this is negligible, but if a user loads many images in succession the accumulated blob URLs hold their backing data in memory until the page is closed.

---

## Summary Table

| # | Area | File | Severity |
|---|------|------|----------|
| 1 | Race condition — shared temp file | `app.py:221` | High |
| 2 | No rate limiting | `app.py` all routes | Medium |
| 3 | No CSRF protection | `app.py` all POST routes | Medium |
| 4 | Silent broad exception handlers | `app.py:181,236,346` / `app.js:140,413,534` | Medium |
| 5 | `display_timer` not range-validated | `app.py:81` | Low–Medium |
| 6 | Loose `samsungtvws` version bound | `requirements.txt:2` | Medium |
| 7 | No lock file / reproducible env | `requirements.txt` | Low–Medium |
| 8 | Token stored next to source code | `app.py:40` | Low–Medium |
| 9 | XSS via `data.error` in `innerHTML` | `app.js:739` | Low–Medium |
| 10 | Bulk upload "X of N" toast miscounts | `app.js:418` | Low |
| 11 | Pairing alert heuristic is fragile | `app.js:457` | Low |
| 12 | Launcher uses `kill -9` | `Launch Frame TV Art.command:16` | Low |
| 13 | No loading state for mattes/artworks | `app.js:105,734` | Low |
| 14 | No maxlength on IP input | `templates/index.html:110` | Very Low |
| 15 | `uploads/` created world-readable | `app.py:42` | Low |
| 16 | Header badge hardcodes "2024" | `templates/index.html:26` | Very Low |
| 17 | No automated tests | — | Medium |
| 18 | Blob URL leak on crop reset | `app.js:271` | Very Low |
