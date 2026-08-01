# Frame TV Art

Local Python/Flask app that uploads and manages art on a Samsung Frame TV over the LAN. Runs on the same network as the TV at http://127.0.0.1:5001.

## Knowledge base

In this repo:

- `BUG_BASH.md` — known bugs and full debugging history
- `TEST_REPORT.md` — test results
- `.planning/codebase/` — `ARCHITECTURE`, `STACK`, `STRUCTURE`, `CONVENTIONS`, `INTEGRATIONS`, `TESTING`, `CONCERNS`
- `design/spec.md` — design spec

Mirrored in the Obsidian vault at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/ObsidianVault/claude-code/frame-tv-art`.

Read `BUG_BASH.md` before re-investigating anything. The TV connection bugs have a long history; do not rediscover them.

## Run & test

```
python3 app.py &          # server on :5001
python3 -m pytest tests/ -v
```

## TV connection — invariants

Token persistence is **implemented and must stay that way** (`app.py`, `TOKEN_FILE` → instance path, `SamsungTVWS(host, port=8002, token_file=TOKEN_FILE)`). Without a `token_file` argument the library requests a new token on every connection and the TV prompts to pair every run.

- Port is **8002**, not 8001.
- `token_file` must be an **absolute** path, in a directory writable by the app process.
- Correct behaviour: TV prompts to pair exactly once, ever; the token file is written immediately and every later run connects silently.

If the TV starts prompting to pair more than once, that is a token-persistence regression — fix it before debugging anything else.

**Verifying a connection/auth change** (the TV cannot be mocked or unit tested, so this is manual):

1. Delete the token file. 2. Run the app. 3. Accept the pairing prompt on the TV once. 4. Confirm the token file exists and is non-empty. 5. Restart without touching it. 6. Confirm no second prompt and a successful connection. Steps 4 and 6 must both pass.

## Gotchas

- **`samsungtvws`:** on `MS_CHANNEL_UNAUTHORIZED`, `SamsungTVArt.open()` raises `UnauthorizedError(response)` and silently drops the token. Recover it with `exc.args[0].get("data", {}).get("token")`.
- **Flask temp files:** the server runs `threaded=True`. Never use a fixed filename for temp files inside a request handler — use `tempfile.mkstemp(suffix='.jpg', dir=UPLOAD_FOLDER)` and remove it in a `finally`.
- **Figma Plugin API:** fill/stroke colors must be `{r, g, b}` with **no `a` key** — use the `rgb()` / `rgba()` / `setStrokes()` helpers, which strip it. `counterAxisAlignItems` accepts only `MIN | MAX | CENTER | BASELINE`; `FLEX_START` is invalid, use `MIN`.
- **macOS Tahoe:** Edit/Write tools may fail with a pre-tool hook error — fall back to Bash + Python for edits. `preview_start` cannot access files under `~/Documents/`; launch the server with Bash instead.

## Reference implementations

- https://github.com/ow/samsung-frame-art
- https://github.com/bc-bane/frameTVArtModePi
- https://jonsully.net/blog/samsung-frame-art-api
