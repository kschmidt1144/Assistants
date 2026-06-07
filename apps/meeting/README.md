# Meeting Copilot

Local-only meeting assistant: live transcription + diarization/speaker-ID, running summary, action
items, transcript history (SQLite). No auth, no cloud (decision #6). See
[REBUILD_PLAN.md](../../REBUILD_PLAN.md) §4.2.

## Status: scaffold (Phase 0)

- `backend/main.py` — FastAPI: `/health`, `/api/models`. Phase 3 adds realtime WS + diarization +
  transcript persistence + summaries.
- `frontend/` — Vite + React 19 (added in Phase 3).

## Run the backend (Phase 0 smoke)

```sh
cd apps/meeting/backend
../../../.venv/bin/uvicorn main:app --reload --port 8002
```
