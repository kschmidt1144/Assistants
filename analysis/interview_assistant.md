# Interview Assistant — Functionality Inventory

> Clean-room rebuild reference. Source: `/Users/kevinschmidt/Repos/OldAssistants/interview_assistant`
> Stack: Vue 3 (Vite) frontend + FastAPI backend + Google Gemini Live API. A real-time interview copilot that transcribes both the interviewer and the candidate, detects questions, and streams STAR-format / quick-answer "hints" to the candidate during a live interview — plus an offline interview-prep mode (projects + behavioral Q&A generated from resume/JD). Ships with a Windows "stealth overlay" that is invisible to screen-share/capture.

---

## Purpose

A live interview assistant. While the candidate is in a real interview (in-person, phone, or remote/video), the app:
1. Transcribes the **interviewer** and the **candidate** as two separate speaker streams via Gemini Live.
2. Runs a parallel **AI Hint Agent** that detects the latest interviewer question and produces a structured answer (STAR format for behavioral/technical, "quick" for follow-ups) — streamed token-by-token onto the screen.
3. Pre-generates an **interview-prep bank** (4–6 projects + 6–8 behavioral answers, all STAR/narrative) from the uploaded resume + job description, with per-project "deep dive" drill-downs.
4. Can run as a **stealth overlay** (frameless, always-on-top, hidden from taskbar, excluded from screen capture) so it's invisible during screen-sharing.

---

## Tech Stack

- **Frontend:** Vue 3.5 `<script setup>` SFCs, Vite 6, plain CSS design system (`assets/main.css`, CSS custom-props, glassmorphism). No state library — composables + `ref`/`watch`. No router. Inter font from Google Fonts.
- **Backend:** Python FastAPI + Uvicorn (async). `google-genai` SDK (the new unified `from google import genai` client, NOT the legacy `google.generativeai`). `python-dotenv`, `python-multipart`. `PyPDF2` + `python-docx` for doc parsing.
- **Overlay (Windows-only):** `ctypes`/Win32 (user32) for window styling + capture protection, `pystray` + `Pillow` for system tray, `keyboard` lib for global hotkeys, Microsoft Edge in `--app` mode as the chrome-less browser host.
- **AI models (exact ids in code):**
  - `gemini-2.5-flash-native-audio-latest` — Live API, audio transcription (env `LIVE_MODEL`). `backend/gemini_live.py` default + `backend/main.py:42`.
  - `gemini-2.0-flash` — Hint agent + project/drill generation (env `HINT_MODEL`). `backend/main.py:43`, `backend/hint_agent.py:83`.
- **Ports:** Read from a monorepo `ports.json` (`Interview_Assistant.{backend,frontend}`) by `vite.config.js` and `main.py`'s `__main__`. Defaults seen in code: backend **8022**, frontend **5122** (overlay/start.md); `main.py __main__` falls back to **8001**. Frontend REST calls hardcode `http://<hostname>:8022` in `ContextPanel.vue` and `ProjectsPanel.vue`; WS calls use the Vite proxy (`/ws`, `/api`, `/health` → backend).

---

## Media I/O (the important part)

All audio is captured in-browser, converted to **16-bit PCM, 16 kHz, mono**, and streamed as **raw binary ArrayBuffers over WebSocket** (no base64). The backend forwards each chunk to Gemini Live tagged `audio/pcm;rate=16000`.

| Channel | Direction | How it's captured & streamed |
|---|---|---|
| **Candidate microphone** | input | `useAudioCapture.js`: `getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false,sampleRate:16000}})` (+ optional `deviceId:{exact}`). `AudioContext({sampleRate:16000})` → `createMediaStreamSource` → **`createScriptProcessor(4096,1,1)`**. In `onaudioprocess`: compute RMS for mic level, convert Float32 [-1,1] → Int16 (`s<0 ? s*0x8000 : s*0x7fff`), emit `pcm16.buffer`. Sent via `audioWs.sendBinary()` to `/ws/audio`. (Comment says AudioWorklet preferred but they use ScriptProcessor for simplicity.) |
| **Interviewer audio — system/tab** (remote interviews) | input | `useInterviewerAudio.js#startSystem`: `getDisplayMedia({video:true,audio:true})`, then **immediately stop+remove the video track** (only audio kept). Throws if no audio track ("share a browser tab with audio"). Same 16 kHz ScriptProcessor → Int16 pipeline. Sent to `/ws/audio/interviewer`. |
| **Interviewer audio — 2nd physical mic** (phone interviews) | input | `useInterviewerAudio.js#startDevice(deviceId)`: `getUserMedia({audio:{deviceId:{exact},…,sampleRate:16000}})`. Same pipeline → `/ws/audio/interviewer`. |
| **Device enumeration** | — | `enumerateDevices()` filters `audioinput`, returns `{deviceId,label}`. Re-enumerated after mic permission granted. ControlBar auto-selects devices by label substring ("yealink" → candidate, "cmtek"/"cm-tek" → interviewer). |
| **Gemini model audio OUT** | (suppressed) | Live config requests `response_modalities=["AUDIO"]` and enables BOTH `input_audio_transcription` and `output_audio_transcription`, but the **system prompt forces the model to stay silent** and the receive loop **logs+discards** any model output transcription. Net effect: transcription-only, no TTS played. |

There is **no webcam/video, no screen-content vision, no TTS playback**. `getDisplayMedia` video is requested only because browsers require it for audio capture, then discarded.

### WebSocket protocol
- `/ws/audio` (candidate) & `/ws/audio/interviewer`: client → server sends **binary PCM frames**; or text `{"type":"stop"}` to end. Server → client sends `{"type":"transcript","text":..,"is_final":bool,"speaker":"candidate"|"interviewer"}`. (`is_final` is always `false` in practice — Gemini input_transcription is incremental.)
- `/ws/hints` (bidirectional, JSON). Client → server commands: `{"cmd":"pause"}`, `{"cmd":"resume"}`, `{"cmd":"query","text":..}`, `{"cmd":"hint_now"}`, `{"cmd":"force_respond"}`. Server → client messages: `{"type":"hint_status","status":"thinking|generating|idle"}`, `{"type":"hint_preview",question,response,hint_id}`, `{"type":"hint_chunk",hint_id,text}` (streaming token), `{"type":"star"|"quick",question,…,hint_id}` (final), `{"type":"none",hint_id}` (no hint; cleans up streaming card), plus ack statuses.

---

## Core Features

### 1. Dual-speaker live transcription
- Two independent `GeminiLiveBridge` instances (`gemini_live.py`), one per WS (`active_bridge`, `active_bridge_interviewer`), each labeled `candidate`/`interviewer` via `speaker_label`. Each holds its own `genai.Client` and runs the Live session inside `client.aio.live.connect(...)` as an async context manager, with concurrent `_send_loop` (drains an `asyncio.Queue` of PCM chunks) and `_receive_loop` (reads `session.receive()`, pulls `server_content.input_transcription.text`). A 15s readiness `Event` gates `connect()`.
- Transcripts are pushed onto a per-WS `asyncio.Queue` and shipped to the browser by a `transcript_sender` background task (decouples Gemini receive loop from socket I/O). Each transcript is **also fed to the shared Hint Agent** via `add_transcript(text, speaker)`.
- UI: `TranscriptionPanel.vue` splits into **Interviewer (70%) / You (30%)** sections, color-codes speakers, and applies a 3s "fresh" highlight to newly arrived segments (decaying bold/color). Auto-scrolls both.

### 2. AI Hint Agent (the centerpiece) — `backend/hint_agent.py`
Runs in a **dedicated background thread** with its **own asyncio event loop and its own `genai.Client`**, fully isolated from the Live transcription stream so LLM latency never stalls transcription. Callbacks are marshaled back to the main loop via `asyncio.run_coroutine_threadsafe`. Key mechanics:
- **Shared, lazily-created** singleton (`AppState.get_or_create_hint_agent`); stopped when the last audio client disconnects (`release_audio_client`).
- **Conversation state machine** (`ConversationState`: IDLE / INTERVIEWER_SPEAKING / QUESTION_DETECTED / CANDIDATE_SPEAKING). Updated on every transcript by speaker. **Interviewer→Candidate turn transition auto-triggers a hint** (`trigger_now()`).
- **Event-driven loop** with adaptive polling timeout (1s while interviewer talks, 5s while candidate talks, else 3s) + a **silence trigger** (interviewer silent ≥1.5s → treat as question complete). Uses a `threading.Event` polled at 200ms (since Events aren't awaitable in the worker loop).
- **Dual-speed hinting:** on trigger, first a **fast preview** (`_generate_fast_hint`, 100 tokens, 1-sentence opener, temp 0.3) is dispatched, then the **full streaming hint** (`_generate_hints_streaming`, 500 tokens, temp 0.5) streams chunks to the frontend; falls back to non-streaming (`_generate_hints`) on stream failure.
- **Hint types:** `"star"` (intro/setting/task/action/result) or `"quick"` (follow-up: question+response), or `"none"`. Output is strict JSON; markdown fences stripped; malformed JSON degrades to a `quick` hint with raw text.
- **De-dup:** tracks last 10 `_previous_questions`, injects them into the prompt as "already answered, do NOT repeat". Only re-analyzes when ≥5 new words accumulate (`_min_new_words`).
- **Phase-4 speculative cache:** after each hint, `_prefill_cache` predicts the 2 most-likely follow-ups and caches answers (normalized-question key, 10-min TTL, with **fuzzy word-overlap match ≥0.7**). (Cache is populated/looked-up but the loop primarily regenerates live.)
- **Manual query** (`query_manual`) and **Force Respond** (`force_respond`, inserted at front of queue, must never return `none`, streams) paths. Force-respond analyzes the ENTIRE transcript by priority: most-recent unanswered Q → unaddressed follow-up → continue current topic → best strategic point.
- **Pause/Resume:** when paused, transcript still accumulates but no auto-hints (manual/force still work).
- Prompt grounding: every generator injects resume (≤2000 chars), JD (≤1500), key topics. System prompt (`HINT_SYSTEM_PROMPT`) enforces casual-conversational tone, first person, NO repeated company names ("in my current role" not "At Huntington…").

### 3. Client-side question detection
`App.vue` has a regex `QUESTION_PATTERNS` list (`/\?\s*$/`, "tell me about", "describe a time", "walk me through", "tell me more", "go on", etc.). When interviewer transcript matches (3s cooldown), it sends `{"cmd":"hint_now"}` to nudge the agent — a redundant trigger layered on top of the server-side state machine.

### 4. Interview-prep generation (offline) — `backend/main.py`
- `POST /api/projects/generate`: feeds resume+JD+topics (+ list of already-generated project names) to `gemini-2.0-flash` with `PROJECT_GEN_PROMPT` (temp 0.4, max 16k tokens). Returns a JSON object `{projects:[…], behavioral:[…]}`. **Additive** — appends to the cached bank each call ("Generate More"). Projects have name/role/context/skills/jd_match/impact/architecture/star. Behavioral: first two are `introduction` items with a flowing `response` narrative (Tell Me About Yourself / Technical Background, no STAR); the rest are STAR-format across categories (leadership/teamwork/conflict/failure/growth/decision-making/mentoring).
- `POST /api/projects/drill` (`DRILL_DOWN_PROMPT`, temp 0.5, max 2k): expands a chosen project into `talking_points`, `technical_depth`, `challenges`, `metrics`, `follow_ups[{q,a}]`, optionally weighted toward a typed `area`.
- UI: `ProjectsPanel.vue` — full-screen overlay (Teleport), Projects/Behavioral tabs, expandable cards, STAR rendering with S/T/A/R color bars, JD-match skill highlighting (green tags), "Deep Dive" drill view with a "Drill Deeper" free-text input.

### 5. Stealth overlay (Windows) — `backend/overlay.py`
- Launched via `POST /api/overlay/launch` (spawns `overlay.py` subprocess with frontend URL + backend port). Overlay launches **Edge in `--app` mode** (frameless, isolated temp user-data-dir, many `--disable-*` flags incl. disabling Edge smart-text-selection that blocks buttons), appends `?overlay=1` so the Vue app knows it's in overlay mode.
- Finds the Edge HWND by PID (`EnumWindows`), then applies Win32 stealth:
  - **`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE=0x11)`** → window invisible to screen capture/share.
  - Hide from taskbar/Alt-Tab (`WS_EX_TOOLWINDOW`, strip `WS_EX_APPWINDOW`), re-applied on a timer because Edge spawns child windows.
  - Always-on-top (`HWND_TOPMOST`), layered opacity (`SetLayeredWindowAttributes`, 20–255 alpha), optional frameless (strip `WS_CAPTION|WS_THICKFRAME`).
- **Global hotkeys** (`keyboard` lib, `suppress=True`): `Ctrl+Shift+H` toggle visibility, `Ctrl+Shift+S` toggle stealth, `Ctrl+Shift+Q` quit.
- **System tray** (`pystray`): "Hide/Show Overlay", "✓ Stealth Mode" toggle, "Quit"; disguised tooltip "System Service" + generated shield icon.
- **Frontend↔overlay sync via HTTP polling:** overlay polls `GET /api/overlay/status` every 2s; the Vue ControlBar toggles stealth/visibility/opacity via `POST /api/overlay/{stealth,visibility,opacity}`, which mutate a shared `overlay_state` dict the overlay process reads — so the in-app stealth button + opacity slider drive the native window. ControlBar detects overlay mode via `display-mode: standalone` media query / `?overlay=1` and switches to a stacked layout with a device-setup screen, stealth shield button, and opacity slider.

---

## AI Capabilities Summary

- **Realtime streaming STT:** Gemini Live (`gemini-2.5-flash-native-audio-latest`), bidirectional WS, `input_audio_transcription` for incremental transcripts; model kept silent by system prompt. Context-primed for accuracy with key-topics + resume/JD snippets (first 500 chars each).
- **Streaming LLM generation:** `generate_content_stream` for live hints + force-respond (token chunks pushed to UI); non-streaming `generate_content` for batch project/drill generation and fast previews.
- **Structured JSON output** everywhere (no function/tool calling, no JSON schema/response_mime_type — relies on prompt + manual fence-stripping + `json.loads`).
- **No vision, no TTS, no embeddings/RAG, no function calling.** All "agentic" behavior is the custom Python thread + state machine.
- **Prompt engineering** is the core IP: `HINT_SYSTEM_PROMPT`, `PROJECT_GEN_PROMPT`, `DRILL_DOWN_PROMPT`, and the silent-transcriber `SYSTEM_INSTRUCTION_BASE` are all detailed, tone-controlled, and JSON-schema-by-example.

---

## UI / UX

- **Layout:** header → collapsible Context panel → 2-column grid (TranscriptionPanel | HintPanel) → ControlBar footer; ProjectsPanel as full-screen overlay. Dark glassmorphism theme (indigo/violet/emerald/rose/amber accents, blur panels) in `assets/main.css`.
- **ControlBar:** record toggle (pulsing ring when live), interviewer-audio controls (Screen Audio button + "2nd Mic" device picker, active status + stop), AI query input ("Ask AI / paste a question"), **Force** button (shows Thinking…/Generating…), Projects button, Audio/Hints status pills. Overlay mode adds device-setup dropdowns, stealth shield, opacity slider; non-overlay adds "Launch Overlay" button.
- **HintPanel:** Auto/Paused toggle, hint count, empty state; card types — preview (italic, pulsing, typing cursor), STAR (color-labeled Intro/Setting/Task/Action/Result), quick (Q + response), streaming (live text + blinking cursor). Auto-scroll; `TransitionGroup` animations; preview cards replaced by full hint sharing `hint_id`.
- **TranscriptionPanel:** 70/30 interviewer/candidate split, per-segment freshness fade, **text-selection popup → "Send to AI"** (selects transcript text, emits a manual query). Uses `Teleport` for the floating popup.
- **ContextPanel:** drag-drop/click dropzones for Resume + JD (PDF/DOCX/DOC/TXT), Key Topics text input, status badges (Resume✓/JD✓/Topics✓/N projects/Saved✓ from restored session), Clear All. Loads `/api/context` on mount to reflect restored session.
- **ProjectsPanel:** loading/error/empty states, Projects/Behavioral tabs with counts, expandable cards, "Generate More", drill-down view with talking points / technical depth / challenges / metrics / follow-up Q&A and a "Drill Deeper" input.

---

## Backend Services / Endpoints (`backend/main.py`)

- **App lifecycle:** `lifespan` loads session on startup, disconnects bridges + stops agent on shutdown. CORS `*`. Shared `AppState` singleton (bridges, hint clients list, hint agent, overlay subprocess handle, audio client count, context dict, generated_projects, generated_behavioral).
- **Context:** `POST /api/context` (multipart: resume file, JD file or text, key_topics → parsed + stored + auto-saved), `GET /api/context` (status/char counts), `DELETE /api/context` (clear + save).
- **Projects:** `POST /api/projects/generate`, `GET /api/projects`, `POST /api/projects/drill`.
- **Overlay:** `POST /api/overlay/{stealth,visibility,opacity,launch}`, `GET /api/overlay/{status,running}`.
- **Health:** `GET /health` (live_connected, hint_agent_running).
- **WebSockets:** `/ws/audio`, `/ws/audio/interviewer`, `/ws/hints` (the hint WS auto-creates the agent on `query`/`force_respond` if none exists, wiring broadcast callbacks to all connected hint clients).
- **Doc parsing** (`doc_parser.py`): `.pdf` via PyPDF2 `PdfReader.extract_text()` per page; `.docx/.doc` via `python-docx` paragraphs; `.txt` UTF-8 decode. Returns plain text or "" on failure.

---

## Data / Persistence

- **`backend/session_data.json`** — the only persistence. Auto-saved on every context change and project generation; restored on startup. Schema: `{ context:{resume_text, jd_text, key_topics}, generated_projects:[…], generated_behavioral:[…] }`. (Live file in repo contains a real resume + JD + 13 generated projects + behavioral items.)
- Uploaded documents are parsed to text immediately; **raw files are not stored** (only extracted text).
- **No database, no auth, no user accounts, no transcript persistence** (transcripts live only in browser memory for the session and in the hint agent's in-RAM buffer, cleared on stop).
- `.env`: `GEMINI_API_KEY` (required), optional `LIVE_MODEL`, `HINT_MODEL`, `BACKEND_PORT`, `FRONTEND_PORT`. Note: `main.py` explicitly **pops `GOOGLE_API_KEY`** from env so the SDK doesn't shadow `GEMINI_API_KEY`.

---

## Reusable Patterns (worth carrying into a rebuild)

1. **Isolate the slow LLM "reasoning" agent on its own thread + event loop + client** so realtime STT/streaming is never blocked; marshal results back with `run_coroutine_threadsafe`. (`hint_agent.py`)
2. **Queue + dedicated sender task** between the model receive loop and the client socket (`transcript_queue` + `transcript_sender`) to decouple producer/consumer.
3. **Conversation turn-taking state machine + adaptive polling + silence detection** to decide *when* to generate a hint, instead of fixed polling. Interviewer→candidate transition = strong trigger signal.
4. **Dual-speed UX:** instant lightweight "preview" (low tokens, low temp) correlated by `hint_id`, then a streamed full answer that replaces it. Plus `type:"none"` sentinel to clean up streaming cards.
5. **Two parallel Live sessions for speaker separation** (one per audio source, each tagged with a speaker label) — simpler and more reliable than diarization.
6. **In-browser PCM16@16k via ScriptProcessor**, raw-binary over WebSocket, `audio/pcm;rate=16000` blob to Gemini — a clean, low-overhead realtime audio path (no base64 bloat).
7. **Native-window stealth via Win32 `WDA_EXCLUDEFROMCAPTURE`** + taskbar hiding + Edge `--app` host, controlled from the web UI through a polled shared-state endpoint (frontend can drive a native window without IPC).
8. **Speculative follow-up cache** with normalized-question keys + fuzzy overlap matching for sub-second answers to predictable follow-ups.
9. **Schema-by-example JSON prompting** with robust fence-stripping + graceful fallback to a freeform card.
10. **Additive generation** (pass already-generated names back to the model to avoid duplicates) for an ever-growing prep bank.
11. **Heavy tone engineering** in prompts (ban resume-bullet voice, ban repeated company names, force first-person conversational STAR) — produces genuinely usable spoken answers.

---

## Limitations / Tech Debt

- **Windows-only stealth.** `overlay.py` uses `ctypes.windll`, `WDA_EXCLUDEFROMCAPTURE`, Edge paths, and the `keyboard` lib (needs admin for global hotkeys; suppress=True). None of this works on macOS/Linux. The user's current machine is macOS — overlay is non-functional there.
- **ScriptProcessorNode is deprecated** (the comment even says AudioWorklet is preferred). Resampling relies on `AudioContext({sampleRate:16000})` being honored, which not all browsers do precisely.
- **Port config fragility:** depends on a monorepo `ports.json` that isn't present in this folder; frontend REST hardcodes `:8022`; `main.py __main__` defaults to `:8001` while overlay/start.md assume `:8022`. Three sources of truth.
- **No JSON-mode / response schema** — relies on prompt + manual parsing; brittle vs. malformed model output (mitigated by fence-stripping + fallback).
- **No auth, no multi-user, no persistence of transcripts**; `session_data.json` is global single-user state. Generated bank is append-only (no edit/delete of individual items; only Clear All).
- **CORS wide open (`*`)** and overlay control endpoints are unauthenticated.
- **Echo/cross-talk risk:** candidate mic + system audio can capture each other; `echoCancellation:true` only on mic paths, not on system-audio capture.
- **`is_final` is effectively always false**; no final/interim consolidation, so transcript segments are raw incremental chunks concatenated.
- **`drillIntoBehavioral` exists but is never wired** to a button in ProjectsPanel (behavioral drill is dead code). Several CSS classes (agent-status-bar, drill-questions) are unused.
- **Verbose per-event logging** in the Gemini receive loop (`logger.info` on every event) would be noisy/expensive in production.
- **Ethical note:** the product's headline feature is covertly assisting in (and hiding from screen capture during) live interviews. A rebuild should weigh this explicitly.

---

## Unique Value (vs. sibling assistants)

This is the only assistant that does **real-time, dual-speaker (interviewer + candidate) live interview coaching** with a **turn-taking-aware hint agent** that streams STAR/quick answers the moment the interviewer finishes a question — combined with a **screen-capture-invisible stealth overlay**. It pairs that live mode with an **offline resume/JD-grounded prep bank** (projects + behavioral, JD-skill matching, deep-dive drill-downs). The defining trick is the dual-speed, turn-transition-triggered, thread-isolated hint pipeline plus Win32 capture exclusion.
