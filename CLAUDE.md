# Frame TV Art — Claude Rules

⚠️ READ THIS BEFORE DOING ANYTHING ELSE
## The One Unresolved Problem

Token persistence is broken. This is the root cause of every connection failure.

**Symptoms:**
* The TV shows a pairing prompt every time the app runs
* The app accepts the pairing but never successfully connects
* This has happened across multiple debug sessions

**What "fixed" looks like:**
* The TV shows a pairing prompt exactly once, ever
* A token file is written to disk immediately after that pairing is accepted
* Every subsequent run connects silently with no prompt
* The token file persists between app restarts

Do not move on to any other issue until this is confirmed working end to end.

## Token Implementation Requirements

Samsung's WebSocket API requires a `token_file` argument when instantiating `SamsungTVWS`. Without it, a new token is requested on every connection.

The correct pattern is:
```python
import os
from samsungtvws import SamsungTVWS

TOKEN_PATH = os.path.join(os.path.dirname(__file__), "tv-token.txt")

tv = SamsungTVWS(
    host=TV_IP,
    port=8002,
    token_file=TOKEN_PATH
)
```

**Checklist before assuming the connection code is correct:**
* `SamsungTVWS` is instantiated with `port=8002` (not 8001)
* `token_file` points to an absolute path, not a relative one
* That file path is writable by the app process
* After the first successful pairing, `tv-token.txt` actually exists on disk
* On subsequent runs, the token file is read and no pairing prompt appears on the TV

If the TV is prompting to pair more than once, stop and fix token persistence. Do not attempt to debug anything else first.

## Debugging Protocol

Because the TV cannot be mocked or unit tested, every change to connection or auth code must be verified manually:

1. Delete `tv-token.txt` if it exists
2. Run the app
3. Watch the TV — accept the pairing prompt once
4. Confirm `tv-token.txt` was created and is non-empty
5. Restart the app without touching the token file
6. Confirm the TV does NOT prompt again and the connection succeeds

Only if steps 4 and 6 both pass is the token issue resolved.

## What Has Already Been Tried

* Multiple rounds of debugging connection and auth failures (see BUG_BASH.md)
* The TV consistently asks to pair multiple times, indicating the token is not persisting
* The app is a Python/Flask app running locally on the same network as the TV

## Known Working References

Other projects using the same samsungtvws library that handle token persistence correctly:
* https://github.com/ow/samsung-frame-art
* https://github.com/bc-bane/frameTVArtModePi
* https://jonsully.net/blog/samsung-frame-art-api

When in doubt, compare the `SamsungTVWS` instantiation in `app.py` against these examples.

---

porary files in Flask routes

Flask runs with `threaded=True`. Never use a fixed filename for temp files
inside request handlers — concurrent uploads would corrupt each other.

**Wrong:**
```python
temp_path = os.path.join(UPLOAD_FOLDER, 'upload_temp.jpg')
img.save(temp_path, ...)
```

**Correct — unique file per request:**
```python
fd, temp_path = tempfile.mkstemp(suffix='.jpg', dir=UPLOAD_FOLDER)
os.close(fd)
try:
    img.save(temp_path, ...)
    ...
finally:
    if os.path.exists(temp_path):
        os.remove(temp_path)
```

Always `import tempfile` at the top of `app.py`.

## Environment quirks (macOS Tahoe)

The Edit and Write tools may fail with a pre-tool hook error (missing security
guidance plugin script). Workaround — use Bash + Python to edit files:
```bash
python3 -c "
with open('app.py') as f: c = f.read()
c = c.replace('OLD_STRING', 'NEW_STRING')
with open('app.py', 'w') as f: f.write(c)
"
```

`preview_start` cannot access files under `~/Documents/` (macOS sandbox).
Launch the server with Bash instead: `python3 app.py &`
App runs on http://127.0.0.1:5001. For LAN access: `FRAME_TV_HOST=0.0.0.0 python3 app.py`

## Running tests

`python3 -m pytest tests/ -v` — unit tests for TVConnection retry logic

## samsungtvws library gotcha

When the TV sends `MS_CHANNEL_UNAUTHORIZED`, `SamsungTVArt.open()` raises
`UnauthorizedError(response)` and **silently drops any token** in the response.
To save/inspect the token: `exc.args[0].get("data", {}).get("token")`.
The token file lives at `~/.cache/frame-tv-art/samsung_tv_token.txt` (mode 0600).
