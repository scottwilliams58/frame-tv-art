#!/bin/bash
APP_DIR="/Users/scottwilliams/Documents/Claude Code/frame-tv-art"
PORT=5001
LOG="$HOME/Library/Logs/frametv-art.log"

# If already running, just open the browser
if lsof -ti tcp:$PORT > /dev/null 2>&1; then
    open "http://localhost:$PORT"
    exit 0
fi

# Start the server in the background
cd "$APP_DIR"
/usr/bin/python3 app.py >> "$LOG" 2>&1 &

# Wait up to 5 s for it to be ready
for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    if lsof -ti tcp:$PORT > /dev/null 2>&1; then
        break
    fi
done

open "http://localhost:$PORT"
