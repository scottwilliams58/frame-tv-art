#!/bin/zsh
# ── Frame TV Art Uploader launcher ──────────────────────────────────────────
# Double-click this file (or keep it in your Dock) to start the app.
# A browser tab opens automatically. Close this Terminal window to stop it.

APP_DIR="/Users/scottwilliams/Documents/Claude Code/frame-tv-art"
PORT=5001

echo "🖼  Frame TV Art Uploader"
echo "──────────────────────────────────────"

# Kill any existing instance on this port
if lsof -ti tcp:$PORT &>/dev/null; then
  echo "Stopping previous instance…"
  lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null
  sleep 0.5
fi

cd "$APP_DIR"
echo "Starting server at http://localhost:$PORT"
python3 app.py &
SERVER_PID=$!

# Wait until the server is accepting connections (up to 5 s)
for i in {1..10}; do
  if curl -s http://localhost:$PORT/ >/dev/null 2>&1; then break; fi
  sleep 0.5
done

open "http://localhost:$PORT"
echo "Browser opened. Close this window to stop the server."
echo ""

# Keep the window open and the server running until user closes it
wait $SERVER_PID
