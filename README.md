# Assistants

Focused AI assistants built on one shared core. A clean-room rebuild of five older prototypes
(`~/Repos/OldAssistants`) — see **[REBUILD_PLAN.md](./REBUILD_PLAN.md)** for the full plan and the
locked decisions.

## Apps (`apps/`)

| App | What it does | Status |
|---|---|---|
| **coding** | Screen/camera-aware coding copilot (live commentary + deep analysis + capture toolkit) | scaffold |
| **meeting** | Meeting transcription, notes, summaries — **local-only** | scaffold |
| **jobs** | Resume tailoring + application tracker (manual job intake, no scraping) | scaffold |

## Shared core (`packages/`)

- **core-py** — Python backend core: Gemini Live bridge, Claude client, provider router, model
  registry, doc parsing, SQLite persistence.
- **core-web** — TypeScript/React frontend core: AudioWorklet capture, video/screen capture, realtime
  WebSocket client, in-page overlay UI kit.

## Architecture

Realtime audio/video → **Gemini Live**; deep reasoning → **Claude** (Opus 4.8 / Sonnet 4.6 / Haiku 4.5).
Each app = a React frontend (Vite) + a local FastAPI backend that owns the API keys. Browser apps,
no desktop shell; everything runs locally.

## Setup

Prereqs: **Node ≥ 20** (have 24), **Python 3.13** (`/opt/homebrew/bin/python3.13`).

```sh
cp .env.example .env            # then fill in ANTHROPIC_API_KEY + GOOGLE_API_KEY

# JS workspaces (core-web + app frontends)
npm install

# Python core (editable) into a local venv
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e "packages/core-py[dev]"
pytest packages/core-py        # offline tests should pass without API keys
```

See each app's `README.md` for run instructions (added as apps are built).
