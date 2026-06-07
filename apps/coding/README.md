# Coding Copilot

Screen/camera-aware coding helper: live commentary (Gemini Live) + deep analysis (Claude), with a
capture toolkit (OCR, region→analyze, scroll-capture, annotations) and an in-page glass overlay.
First app in the build order. See [REBUILD_PLAN.md](../../REBUILD_PLAN.md) §4.1.

## Status: scaffold (Phase 0)

- `backend/main.py` — FastAPI: `/health`, `/api/models` (consumes `assistants_core`). Phase 2 adds
  the realtime WS route + deep-analysis endpoints.
- `frontend/` — Vite + React 19 app consuming `@assistants/core-web` (added in Phase 2).

## Run the backend (Phase 0 smoke)

```sh
# from repo root, with the venv created (see root README)
cd apps/coding/backend
../../../.venv/bin/uvicorn main:app --reload --port 8001
# → http://localhost:8001/health   and   /api/models
```
