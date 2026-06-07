# Assistants

Focused AI assistants built on one shared core. A clean-room rebuild of five older prototypes
(`~/Repos/OldAssistants`) — see **[REBUILD_PLAN.md](./REBUILD_PLAN.md)** for the full plan and the
locked decisions, and **[SECURITY.md](./SECURITY.md)** for the local-first threat model.

## Apps (`apps/`)

| App | What it does | Status |
|---|---|---|
| **coding** | Screen/camera-aware coding copilot — live commentary (Gemini Live, voice I/O) + Claude deep analysis + capture toolkit (OCR/region/annotate) | built |
| **meeting** | Local-only meeting copilot — Web-Speech transcription + local speaker-ID + Claude notes (summary/actions/clean/ask) | built |
| **jobs** | Resume tailoring (tailor→ATS→retry) + application tracker, manual job intake (no scraping) | built |

## Shared core (`packages/`)

- **core-py** — Python backend core: Gemini Live bridge + realtime session, Claude client, provider
  router + model registry, local speaker-ID voice embeddings, doc parsing, SQLite persistence.
- **core-web** — TS/React frontend core: AudioWorklet capture, video/screen capture, RealtimeClient,
  Web-Speech transcription, AudioPlayback, in-page overlay UI kit (DraggableWindow, MarkdownRenderer).

## Architecture

Realtime audio/video → **Gemini Live** (native-audio); deep reasoning → **Claude** (Opus 4.8 /
Sonnet 4.6 / Haiku 4.5). Each app = a React frontend (Vite) + a local FastAPI backend that owns the
API keys (the browser never sees them). Browser apps, no desktop shell; everything runs locally.

## Quick start

Prereqs: **Node ≥ 20**, **Python 3.13**.

```sh
scripts/setup.sh                 # venv + editable core install + npm workspaces
cp .env.example .env             # add ANTHROPIC_API_KEY (+ GOOGLE_API_KEY for the Coding app)
scripts/dev.sh coding            # or: meeting | jobs   → backend + Vite frontend
```

| App | Frontend | Backend |
|---|---|---|
| coding | http://localhost:5173 | :8001 |
| meeting | http://localhost:5174 | :8002 |
| jobs | http://localhost:5175 | :8003 |

## Development

```sh
scripts/test.sh     # ruff + pytest (core + each app backend) + TS typecheck
scripts/build.sh    # production build of all app frontends
```

- **Lint:** `ruff` (config in `ruff.toml`).
- **Tests:** `pytest` — core-py (20) + per-app backends (coding/meeting/jobs). App backends run
  separately (same-named modules across apps). Live provider tests are marked `live` and skipped
  without API keys.
- **Types:** strict `tsc --noEmit` across all TS workspaces.
- **Speaker-ID quality:** default is a numpy fallback; `pip install -e "packages/core-py[speaker]"`
  installs resemblyzer for higher accuracy.
- **Open build-time item (#8):** the realtime model defaults to a native-audio Gemini Live id; confirm
  your key serves it or set `GEMINI_LIVE_MODEL` (see `.env.example`).
