# CLAUDE.md — `Assistants`

A local-first **monorepo of three browser-based AI assistants**, built on two shared core packages:
- **`coding`** — screen/camera coding copilot (the one realtime app).
- **`meeting`** — local-only meeting transcription + AI notes.
- **`jobs`** — resume tailoring + application tracker.

A deliberate **clean-room rebuild** of the five prototypes now archived in `../OldAssistants/`,
consolidating their ~70%-shared plumbing (audio capture → WebSocket → Gemini Live; FastAPI key-hiding
backend; "realtime + deep reasoning" model split) into one core. **`REBUILD_PLAN.md` is the source of truth.**

## Structure

- `packages/core-py/` — shared Python backend `assistants_core` (pip-installed editable as `assistants-core`): `config` (env/.env), `models` (role→model registry), `providers` (`ClaudeClient`, `GeminiLiveBridge`, `ProviderRouter`), `realtime`, `transcription` (local speaker-ID), `docs` (PDF/DOCX), `persistence` (SQLite).
- `packages/core-web/` — shared TS/React frontend `@assistants/core-web`: AudioWorklet/screen capture, `RealtimeClient` + `useRealtime`, overlay UI kit, `protocol.ts` (the one WS envelope). **Consumed as raw TS source** (Vite `optimizeDeps.exclude`), no build step.
- `apps/coding/` — backend :8001, frontend :5173. Realtime (`WS /ws/live` Gemini Live) + `POST /api/analyze` (Claude) + `/api/ocr`.
- `apps/meeting/` — backend :8002, frontend :5174. Local-only: transcription is in-browser Web-Speech (no backend WS); backend does speaker-ID, Claude notes, SQLite persistence.
- `apps/jobs/` — backend :8003, frontend :5175. Non-realtime, Claude-only: JD parse → tracker (SQLite, dedup-by-URL) → tailor→ATS→retry resume engine.
- `analysis/` — per-old-prototype inventories (rebuild reference) · `e2e/` + `playwright.config.ts` · `scripts/`.

## Architecture (multi-package flows)

- **Each app = React (Vite) frontend + its own local FastAPI backend**, one origin per app. The Vite dev server proxies `/api` (and, for `coding`, `/ws`) to that backend, so **the browser never sees API keys**. CORS is scoped to the exact `localhost:517x` origin, not `*`.
- **Backends consume `assistants_core`** via a module-level `ProviderRouter()` — lazily builds `router.claude` (cached `ClaudeClient`) and `router.gemini_live()` (a fresh `GeminiLiveBridge` per WS). Every backend exposes `/health` + `/api/models`.
- **Model routing is centralized** in `core-py/models.py`: roles `REALTIME` (Gemini Live), `REASON_DEEP/BALANCED/FAST` (Claude). Claude IDs pinned (`claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`); the Gemini Live default is a floating `-latest` alias. The split exists because **Claude has no native realtime API** — Gemini does realtime A/V, Claude does reasoning.
- **Frontends consume `@assistants/core-web` as TS source**; realtime apps speak `protocol.ts`'s normalized `ClientMessage`/`ServerMessage` envelope, bridged to Gemini Live by core-py's `RealtimeSession`.
- **Persistence:** one shared SQLite file (`ASSISTANTS_DB_PATH`, default `./data/assistants.sqlite`), namespaced per app.

## Commands

- **install:** `scripts/setup.sh` — creates `.venv`, `pip install -e "packages/core-py[dev]"`, then `npm install --cache "$PWD/.npmcache"`.
- **run (one app at a time):** `scripts/dev.sh <coding|meeting|jobs>` — that app's uvicorn backend + its Vite frontend. **There is no root run-all.**
- **build:** `scripts/build.sh` → `npm run build --workspaces` (each frontend: `tsc --noEmit && vite build`).
- **test:** `scripts/test.sh` → `ruff` → `pytest packages/core-py` → `pytest apps/<app>/backend` **run separately per app** → `npm run typecheck`. E2E: `npx playwright test` (fake media; auto-starts all 6 servers). Key preflight: `python scripts/check_keys.py`.

## Locked decisions (`REBUILD_PLAN.md` §1.2)

- **npm workspaces — NOT pnpm/turbo** (no `pnpm-workspace.yaml`/`turbo.json`/`packageManager`). Workspaces are `packages/core-web` + `apps/*/frontend`; `core-py` is pip-installed, not an npm workspace.
- **React 19 + TS strict** (`noUncheckedIndexedAccess`), Vite 7 — **no Vue** (the old apps were Vue 3).
- **Browser apps only** — no Electron/Tauri; the overlay is in-page.
- **Gemini Live + Claude only** — no Deepgram/AssemblyAI/OpenAI.
- **Meeting is local-only** — no Firebase/auth/Cloud Run. Diarization = local voice-embeddings (resemblyzer optional, numpy fallback).
- **Python 3.13** venv (no `uv`); `assistants-core` requires-python `>=3.11`.

## Non-obvious gotchas

- **Env: `GOOGLE_API_KEY`** (not `GEMINI_API_KEY`) + `ANTHROPIC_API_KEY`. `.env` already has both locally.
- **Run app backends as separate pytest invocations** — same-named modules (`main`/`prompts`/`store`) across apps collide on import if collected together (`test.sh` already splits them).
- **Backend launch path matters:** `dev.sh` uses `uvicorn --app-dir apps/<app>/backend main:app` (puts the backend dir on `sys.path` for flat sibling imports; CWD stays repo root for `.env`); Playwright uses `PYTHONPATH=apps/<app>/backend uvicorn apps.<app>.backend.main:app`. Running uvicorn the "wrong" way breaks `from prompts import …`.
- **Broken global npm cache on this machine** → install must use `--cache "$PWD/.npmcache"` (a tracked `.npmcache/`); plain `npm install` may EACCES.
- **Gemini Live model is a floating `-latest` alias** and the one unverified-live piece — confirm the key serves it (`scripts/check_keys.py` checks for `bidiGenerateContent`) or set `GEMINI_LIVE_MODEL`.
- **Stale READMEs:** `apps/coding/README.md` and `apps/meeting/README.md` say "Phase 0 scaffold" — outdated; both are fully built. Trust `REBUILD_PLAN.md` §9 / `TEST_PLAN.md` / the code.
- **Lint = `ruff` only** (Python); there is **no JS/TS linter** (no ESLint). TS safety comes from each app's `tsc`.

## Pointers

- **`REBUILD_PLAN.md`** (5→3 mapping, locked decisions, capability catalog, per-app specs, model design, roadmap) · `TEST_PLAN.md` (exact test inventory) · `SECURITY.md` (local-first threat model) · `analysis/*.md`.
- Old→new: `coding` ← codeassistant + Live_Assistant code mode · `jobs` ← jobapplicationassistant · `meeting` ← Live_Assistant meeting mode · `interview_assistant` dropped. See `../OldAssistants/CLAUDE.md`.
- Workspace map: `../CLAUDE.md`.
