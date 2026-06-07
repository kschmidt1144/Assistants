#!/usr/bin/env bash
# All checks: lint + Python tests (core + each app backend) + TS typecheck.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> ruff"
.venv/bin/python -m ruff check .

echo "==> pytest: core-py"
.venv/bin/python -m pytest packages/core-py -q

# App backends are run separately: each has same-named modules (main/prompts/store),
# so one combined pytest run would collide on import.
for app in coding meeting jobs; do
  echo "==> pytest: $app backend"
  .venv/bin/python -m pytest "apps/$app/backend" -q
done

echo "==> typecheck: TS workspaces"
npm run typecheck

echo ""
echo "==> All checks passed."
