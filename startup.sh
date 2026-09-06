#!/bin/sh
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
if [ -d "/home/ubuntu/.nvm/versions/node/v24.15.0/bin" ]; then
  export PATH="/home/ubuntu/.nvm/versions/node/v24.15.0/bin:$PATH"
fi
node scripts/preview.mjs stop || true
PORT="${PORT:-8082}"
if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/"; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &

