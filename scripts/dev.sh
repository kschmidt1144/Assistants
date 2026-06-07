#!/usr/bin/env bash
# Launch one app: its FastAPI backend (127.0.0.1) + its Vite frontend.
#   scripts/dev.sh <coding|meeting|jobs>
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-}"
case "$APP" in
  coding)  BPORT=8001; FE="@assistants/coding-frontend" ;;
  meeting) BPORT=8002; FE="@assistants/meeting-frontend" ;;
  jobs)    BPORT=8003; FE="@assistants/jobs-frontend" ;;
  *) echo "usage: scripts/dev.sh <coding|meeting|jobs>"; exit 1 ;;
esac

[ -f .env ] || echo "warning: no .env found — AI features need ANTHROPIC_API_KEY (see .env.example)"

echo "==> $APP backend → http://127.0.0.1:$BPORT"
# --app-dir puts the backend on sys.path (sibling imports) while CWD stays the repo root (.env).
.venv/bin/uvicorn --app-dir "apps/$APP/backend" main:app --host 127.0.0.1 --port "$BPORT" --reload &
BACK=$!
trap 'kill "$BACK" 2>/dev/null || true' EXIT INT TERM

echo "==> $APP frontend (Vite) — proxies /api (+ /ws) to the backend"
npm run dev -w "$FE"
