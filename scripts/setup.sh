#!/usr/bin/env bash
# One-time setup: Python venv + editable core install, and npm workspaces.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-$(command -v python3.13 || command -v python3)}"
echo "==> Python venv (.venv) using: $PY ($("$PY" --version))"
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -e "packages/core-py[dev]"

# Optional: higher-quality speaker-ID (pulls torch). Uncomment to enable.
# .venv/bin/python -m pip install -e "packages/core-py[speaker]"

echo "==> npm workspaces"
# NOTE: a project-local cache sidesteps a broken global ~/.npm cache on this machine.
npm install --cache "$PWD/.npmcache" --no-audit --no-fund

echo ""
echo "==> Setup complete."
echo "    Next: cp .env.example .env  &&  add ANTHROPIC_API_KEY (+ GOOGLE_API_KEY for the Coding app)."
echo "    Then: scripts/dev.sh <coding|meeting|jobs>"
