# Frame TV Art — Claude Rules

## Temporary files in Flask routes

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
