# Job Application Assistant

AI resume tailoring + application tracking. **No scraping** — paste a job description (manual intake).
Non-realtime; reuses the core Claude client, doc parsing, and structured outputs. See
[REBUILD_PLAN.md](../../REBUILD_PLAN.md) §4.3.

## Status: built (Phase 4)

**Backend** (`backend/`): JD parsing (structured), application tracker (SQLite: dedup by URL, status
lifecycle + history, notes, filter, stats), master profile (paste or PDF/DOCX upload), and the LLM
resume engine — **tailor → ATS-score → retry** with a factual-integrity guardrail — plus cover
letters, application Q&A, and a cross-job unified resume.

**Frontend** (`frontend/`): Profile · Add Job (paste JD → AI parse → track) · Tracker (list, status
chips, filter, stats; per-app: tailor resume + ATS view, cover letter, Q&A).

**Deferred:** the deterministic **data-bank resume engine** (per-context DE/DS/MLOps/SWE variants
selected by JD-keyword scoring) + bank editor — a sizeable sub-project needing your bank schema;
the LLM engine above covers tailoring in the meantime.

## Run

```sh
cp ../../../.env.example ../../../.env   # set ANTHROPIC_API_KEY (the AI features use Claude)
cd backend && ../../../.venv/bin/uvicorn main:app --reload --port 8003
# new terminal, repo root:
npm run dev -w @assistants/jobs-frontend   # → http://localhost:5175
```
