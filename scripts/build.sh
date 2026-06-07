#!/usr/bin/env bash
# Production build of all app frontends (tsc + vite).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
echo "==> Built: apps/*/frontend/dist"
