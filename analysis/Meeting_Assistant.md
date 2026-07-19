# Meeting Assistant (Web_Meeting) — Functionality Inventory

> Source root: `~/Repos/OldAssistants/Meeting_Assistant/Web_Meeting`
> Analyzed for a clean-room rebuild. This is an **early-stage prototype / vertical slice** — the plumbing (mic → WebSocket → Gemini Live → streamed text back) works end-to-end, but most "meeting assistant" features (transcript storage, summaries, multi-speaker, screen capture, AI audio out) are stubbed or absent.

---

## Purpose

A cloud-native web app for **real-time microphone audio streaming to Google Gemini Live API**, with the model's streamed **text** responses rendered live in the browser. Branded in-UI as "Gemini Live." Marketed (README) as "real-time audio transcription and AI assistance," but in the current code the model is prompted as a generic `"You are a helpful assistant."` and simply talks back as text — there is no transcription pipeline, diarization, or meeting summarization implemented yet.

Access is hard-locked to a single Google account (`owner@example.com`).

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 (`react@^19.2.0`, `react-dom@^19.2.0`), Vite 7, plain CSS (no framework) |
| Frontend libs | `firebase@^12.7.0` (Auth only), `lucide-react@^0.561.0` (icons), `date-fns@^4.1.0` (**declared but never imported/used**) |
| Backend | Python 3.11, FastAPI (`>=0.111`), Uvicorn, `websockets`, `python-dotenv`, `pydantic`, `python-multipart` |
| AI | Google Gemini Live API via `google-genai` SDK (`google.genai`), model `gemini-2.0-flash-exp` |
| Auth | Firebase Authentication (Google Sign-In popup) on the client; `firebase-admin` ID-token verification on the server |
| Hosting | Frontend → Firebase Hosting (SPA rewrite to `/index.html`); Backend → GCP Cloud Run (Docker) |
| IaC / Deploy | Terraform (`infrastructure/main.tf`), PowerShell deploy script (`infrastructure/deploy_backend.ps1`), Windows `.bat` local launchers |
| GCP project | `meeting-assistant-3a665`, region `us-central1` |

Key files: `frontend/package.json`, `backend/requirements.txt`, `backend/Dockerfile`, `infrastructure/main.tf`.

---

## Media I/O

Only **one** media channel exists: microphone input. There is **no** screen/tab capture, no webcam, no system/loopback audio, and (currently) no audio output.

### Microphone capture → PCM16 → WebSocket (input)
File: `frontend/src/hooks/useAudioRecorder.js` (custom React hook `useAudioRecorder(onAudioData)`).

- Capture via `navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true } })`.
- `AudioContext` created at `sampleRate: 16000` (`window.AudioContext || window.webkitAudioContext`).
- `createMediaStreamSource(stream)` → **`createScriptProcessor(4096, 1, 1)`** (legacy ScriptProcessorNode; code comment explicitly notes AudioWorklet would be better for production but ScriptProcessor was chosen for compatibility).
- In `onaudioprocess`: pulls `inputBuffer.getChannelData(0)` (Float32), converts to **Int16 PCM** manually (`s < 0 ? s*0x8000 : s*0x7FFF`), and emits the raw `Int16Array.buffer` (`ArrayBuffer`) via the `onAudioData` callback.
- A `isRecordingRef` (useRef) gates emission to avoid stale-closure bugs in the audio callback.
- Processor is connected to `audioContext.destination` (required to keep the ScriptProcessor firing).
- `stopRecording()` stops all tracks, disconnects processor/source, closes the AudioContext.
- No chunk buffering/throttling — every ~4096-sample frame is sent as its own binary WebSocket message.

### Audio frame transport
File: `frontend/src/App.jsx` — the `onAudioData` callback does `websocketRef.current.send(audioBuffer)` (binary `ArrayBuffer`) only when `readyState === WebSocket.OPEN`. **Raw PCM16 bytes are sent directly over the WebSocket — NOT base64-encoded** on the client path.

### Audio output (NOT implemented end-to-end)
- Backend `gemini_client.py` config is `response_modalities: ["TEXT"]` (comment notes it *can* be `["TEXT","AUDIO"]`).
- `server.py` has a branch to forward `{type:"audio", data: <base64>}` frames to the client if Gemini ever returns audio, but the receive loop in `gemini_client.py` only yields `text` parts; `inline_data` (audio) handling is a `pass` stub.
- `App.jsx` `ws.onmessage` only handles `type === 'text'`; there is no audio playback (no AudioContext sink / decode) on the client. So **no TTS / spoken responses currently reach the user.**

---

## Core Features

1. **Live mic → Gemini streaming session** — Press "Start Live" to open a WebSocket and stream mic PCM16 to Gemini in real time; press "Stop" to tear down. Implemented across `App.jsx::toggleConnection`, `useAudioRecorder.js`, `server.py`, `gemini_client.py`.
2. **Streamed text responses rendered as cards** — Incoming `text` frames are appended into a "response card." Streaming chunks are concatenated onto the last card while it's `isFinished: false`; logic to mark a card finished / start a new one on turn boundaries is a noted TODO (cards never actually flip `isFinished`, so all text accumulates into one card). `App.jsx::ws.onmessage`.
3. **Google Sign-In auth** — Firebase `signInWithPopup(GoogleAuthProvider)`; `onAuthStateChanged` listener stores the user and fetches an ID token via `getIdToken()`. `App.jsx`, `firebase.js`.
4. **Dev bypass ("Skip (Dev)")** — Sets a fake user and `token = 'dev-token'`; backend special-cases `"dev-token"` to skip auth entirely (`server.py` lines 54-56). Useful for local dev, a security hole in prod.
5. **Single-user whitelist** — Backend rejects any authenticated user whose email is not in `ALLOWED_EMAILS = ["owner@example.com"]` (closes WS with code 1008). `server.py`.
6. **Connection status indicator** — Header shows "Connected" (green) / "Disconnected" (red) driven by WS lifecycle callbacks. `App.jsx`.
7. **Health endpoint** — `GET /health` → `{status:"ok"}` for Cloud Run probes. `server.py`.

---

## AI Capabilities

- **Model:** `gemini-2.0-flash-exp` via `google-genai`'s **Live API** (`client.aio.live.connect(model=..., config=...)`). `backend/gemini_client.py`.
- **Mode:** Realtime bidirectional streaming session (`async with ... as session`), full-duplex: a background asyncio task (`receive_from_gemini`) pumps model output to the browser while the main loop forwards mic audio to the model.
- **Input modality:** audio — `session.send(input={"data": audio_data, "mime_type": "audio/pcm"})`. Documented expected format: **16 kHz, 16-bit PCM, mono.**
- **Output modality:** `response_modalities: ["TEXT"]` (text only). Audio output is configured-but-disabled.
- **System prompt:** hardcoded `"You are a helpful assistant."` in the `config` dict. No meeting-specific instructions, no dynamic/per-session system instruction (a `config` message type is reserved in `server.py` but its handler is a `pass`).
- **Response parsing:** iterates `session.receive()` → `response.server_content.model_turn.parts`; yields `{"type":"text","content":part.text}` for text parts; `inline_data` (audio) parts are caught but ignored (`pass`).
- **NOT present:** function/tool calling, vision/image input (an `image` WS message type is reserved but a `pass` stub in `server.py`), grounding, RAG, summarization, structured output, multi-turn memory/context bank.

---

## UI / UX

File: `frontend/src/App.jsx`, styles in `frontend/src/index.css` (App.css is unused boilerplate; `config.js` only holds the WS URL).

- Single-page app, no router. Dark "Abyss" theme with CSS custom properties (purple `#5c2eff` accent), **glassmorphism** (`.glass-panel`: blur + translucency), gradient primary button.
- **Header:** circular logo + "Gemini Live" title; status dot; Start/Stop button (toggles `Mic`/`MicOff` lucide icons, turns red while recording); Login + "Skip (Dev)" buttons, or the user's Google avatar once signed in.
- **Main area:** horizontally-scrolling flexbox of response cards (`min-width:400px`, full height) — a column/board layout. Empty state: "Ready to Connect / Press Start to begin a conversation with Gemini."
- Each card has a "Gemini" header with a static "Recently" label (no real timestamps despite `date-fns` being installed) and a `.markdown-content` body — note: body renders `resp.content` as **plain text**; there is no markdown parser wired up, though CSS for rendered markdown (h1/h2, `code`, `pre`) exists in anticipation.
- Comment placeholder for "camera preview or overlays" exists but nothing is rendered.
- `lucide-react` icons imported: `Mic`, `MicOff`, `Settings`, `User` (`Settings`/`User` imported but unused). No settings panel, no dark/light toggle.
- **No desktop/OS features:** no overlay, no always-on-top/click-through, no draggable windows, no global hotkeys, no system tray, no multi-monitor, no cursor/screen control. This is a plain browser web app (`overflow:hidden`, full-viewport, app-like feel only).

---

## Backend Services

File: `backend/server.py` (FastAPI app `"Meeting Assistant Backend"`).

- **CORS:** wide open (`allow_origins=["*"]`, all methods/headers, credentials) — flagged TODO for prod.
- **`GET /health`** → `{status:"ok"}`.
- **`WS /ws/stream?token=<firebase_id_token>`** — the only real endpoint:
  1. Reject if no `token` (close 1008).
  2. If `token == "dev-token"` → synthetic dev user, skip auth.
  3. Else `firebase_admin.auth.verify_id_token(token)`; enforce email whitelist; close 1008 on failure/unauthorized.
  4. `websocket.accept()`, read `GOOGLE_API_KEY` from env (close 1008 if missing).
  5. Construct `GeminiLiveClient`, open Live session.
  6. Spawn `receive_from_gemini()` task → forwards `text` frames (with server-side `asyncio` timestamp) and would-be `audio` frames to the browser as JSON.
  7. Main loop on `websocket.receive()`: if `"bytes"` → `client.send_audio(session, bytes)`; if `"text"` → parse JSON, dispatch on `type` (`config` and `image` both `pass` stubs).
  8. Cleanup: cancel receive task on disconnect/error; upstream failure closes with 1011.
- **`backend/auth.py`** — initializes Firebase Admin (default credential chain / `GOOGLE_APPLICATION_CREDENTIALS`, explicit `projectId: meeting-assistant-3a665`); provides `verify_token` (HTTP 401 on failure) and `ws_auth` helpers. (Note: `server.py` calls `firebase_admin.auth.verify_id_token` directly rather than these helpers; importing `auth.py` is mainly to trigger Admin init.)
- **`backend/gemini_client.py`** — `GeminiLiveClient`: wraps `genai.Client`, `connect()`, `send_audio()`, `receive_responses()` (see AI section).

### Deployment / infra
- **Dockerfile** (`backend/`): `python:3.11-slim`, installs gcc, `pip install -r requirements.txt`, runs `uvicorn server:app --host 0.0.0.0 --port ${PORT}` (PORT defaults 8080 for Cloud Run).
- **Terraform** (`infrastructure/main.tf`): enables Cloud Run + Artifact Registry APIs, creates a Docker Artifact Registry repo (`meeting-assistant-repo`), outputs the repo URL and a `gcloud run deploy ... --allow-unauthenticated` command. (Does not itself create the Cloud Run service — build/push/deploy is manual.)
- **`infrastructure/deploy_backend.ps1`**: enables APIs, configures Docker auth, builds & pushes the image, `gcloud run deploy meeting-assistant-backend --allow-unauthenticated --env-vars-file ../backend/.env`.
- **`frontend/firebase.json`**: Firebase Hosting serving `dist/` with SPA rewrite-all → `/index.html`. `.firebaserc` default project `meeting-assistant-3a665`.
- **Local dev:** `start_local.bat` (launches backend uvicorn on :8000 + `npm run dev` on :5173 + opens browser) and `backend/run_server.bat`. Note a port mismatch: frontend `config.js` points at `ws://localhost:8001`, while the .bat starts uvicorn on `:8000` (and README mentions 8001 elsewhere) — must be reconciled on rebuild.
- **Live URLs (README):** frontend `https://meeting-assistant-3a665.web.app`, backend `https://meeting-assistant-backend-724688713590.us-central1.run.app`.

---

## Data / Persistence

- **None.** There is **no Firestore, no database, no transcript storage, no file persistence** anywhere in the code, despite the project name and context hints. (`firebase-admin` is used solely for ID-token verification; the client uses Firebase only for Auth.)
- Responses live only in React `useState` (`responses`) for the session and are lost on reload/disconnect.
- No user profile/context bank, no conversation history, no saved meetings.
- **Secrets/config:** `GOOGLE_API_KEY` (Gemini) and `GOOGLE_APPLICATION_CREDENTIALS` (Firebase SA, local) via `.env` (`backend/.env.example`). Client Firebase web config is inlined in `frontend/src/firebase.js` (`apiKey` left as `"YOUR_FIREBASE_API_KEY"` placeholder — must be filled).

---

## Reusable Patterns (worth carrying into a clean rebuild)

1. **Browser PCM16 capture pipeline** — getUserMedia(16k mono) → AudioContext → Float32→Int16 conversion → emit raw ArrayBuffer. Solid baseline; upgrade ScriptProcessorNode → **AudioWorklet** (already noted as the right move in code comments).
2. **WebSocket as the realtime bridge to a Live LLM** — browser streams binary audio frames; server relays to Gemini Live and fans model output back as JSON. Clean separation: browser never holds the model API key.
3. **Dual-task full-duplex server loop** — one asyncio task receives from the model, the main loop forwards to the model; cancel-on-disconnect cleanup. Good template for any realtime voice agent.
4. **Token-in-query WebSocket auth + email whitelist** — Firebase ID token passed as `?token=`, verified server-side before `accept()`. Plus a `dev-token` escape hatch for local iteration (remove/guard for prod).
5. **`useRef` flag inside the audio callback** to dodge stale-closure issues in long-lived audio processors.
6. **Typed WS message envelope** (`{type: "text"|"audio"|"config"|"image", ...}`) — already extensible for adding image/vision and audio-out without protocol churn.
7. **Cloud-native deploy shape** — Vite SPA on Firebase Hosting + FastAPI on Cloud Run + Terraform-provisioned Artifact Registry; Dockerfile already Cloud-Run-correct (`$PORT`, `0.0.0.0`).

---

## Limitations / Tech Debt

- **Misnamed vs. implemented:** "Meeting Assistant" with "transcription" branding, but no transcription, no diarization, no summaries, no meeting/calendar concepts — just a generic voice→text chat with a "helpful assistant" prompt.
- **No persistence at all** — no transcripts, no history, no Firestore (contrary to expectations).
- **No audio output** — TTS/spoken replies are configured-but-disabled and not played client-side; `inline_data` handling is a stub.
- **No vision / screen / system-audio / multi-speaker** — single mic channel only; `image` message type is a stub.
- **Response card streaming logic incomplete** — `isFinished` never set, so text never breaks into separate turns/cards; "Recently" timestamp is hardcoded (date-fns unused).
- **Markdown not actually rendered** — body shows plain text though markdown CSS + class exist (no parser like `react-markdown`).
- **Security holes for prod:** `allow_origins=["*"]`, permanent `dev-token` bypass, `--allow-unauthenticated` Cloud Run, single hardcoded whitelisted email, deploying via `--env-vars-file ../backend/.env` (secrets in repo `.env`), placeholder client Firebase apiKey.
- **Legacy `ScriptProcessorNode`** (deprecated) instead of AudioWorklet; every ~4096-sample frame sent as a separate WS message (no batching/backpressure).
- **No system-instruction / config wiring** — `config` and `image` WS handlers are `pass`; system prompt can't be changed at runtime.
- **Port inconsistency** between `config.js` (8001), `start_local.bat` (8000), and README.
- **No tests, no error UI** (mic failures only `console.error`), `Settings`/`User` icons imported but unused.
- **No reconnection/retry**, no heartbeat/keepalive, no graceful turn-completion signaling.

---

## Unique Value (vs. sibling assistants)

The one thing this prototype nails that a desktop/Electron assistant typically doesn't: it's a **fully cloud-deployed, browser-only realtime voice pipeline** — React SPA on Firebase Hosting + FastAPI on Cloud Run + Firebase Google-Sign-In auth + Gemini **Live API** over WebSocket, with a clean **server-side relay so the model API key never touches the client**. It's essentially a minimal, deployable reference architecture for "talk to a Gemini Live agent from any browser, authenticated," ready to be extended into the actual meeting features it's named for. Its value is the **deployment + realtime-bridge skeleton**, not (yet) meeting-specific intelligence.
