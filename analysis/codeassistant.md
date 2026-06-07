# CodeAssistant — Functionality Inventory

> Real-time, AI-powered "developer's heads-up display." Point a camera or share your
> screen, and a Gemini model watches the feed and helps with code: live commentary,
> deep one-shot analysis, OCR, region/scroll capture, draw-on-screen annotations — all
> driven from a draggable glass overlay floating on top of the live video.

Root: `/Users/kevinschmidt/Repos/OldAssistants/codeassistant`

---

## Purpose

A coding helper built around a **live video/screen feed**. The user shares their screen
(or points a webcam at, e.g., another monitor/printout) and the app provides two
distinct AI modes over that feed:

- **Live mode** — continuous, low-latency streaming to Gemini Live (native-audio Flash). Frames + mic audio are streamed in real time; the model responds with running commentary. Designed to be "proactive about pointing out issues."
- **Deep Analysis mode** — one-shot, high-quality requests to Gemini Pro over HTTP. Send a screenshot + a question (or a prompt-template), get a thorough markdown answer.

Layered on top: OCR (text extraction from the frame), region select (crop a code area and auto-analyze), scroll capture (stitch many frames of a scrolling document into reconstructed text), freehand annotations composited into screenshots, prompt templates, pinned project context, and a draggable/minimizable overlay control bar.

---

## Tech Stack

- **Frontend:** Vue 3 (`<script setup>` SFCs, Composition API), Vite 6. Single dependency beyond Vue: `marked` v15 for markdown rendering. No state library, no router, no UI kit — hand-rolled glassmorphism CSS with design tokens (`frontend/src/assets/styles.css`). Fonts: Inter + JetBrains Mono via Google Fonts (`index.html`).
- **Backend:** Python FastAPI + Uvicorn (`backend/app.py`). CORS wide open (`allow_origins=["*"]`). Pydantic models for the analysis endpoints.
- **AI SDK:** Google `google-genai` (>=1.0.0) — the unified Gen AI SDK, used for both the Live bidirectional API (`client.aio.live.connect`) and HTTP `generate_content` (`client.aio.models.generate_content`).
- **AI models (as coded):**
  - Live default: `gemini-2.5-flash-native-audio-latest` (constant in `live_client.py` and `constants.js`); selectable alternates `gemini-2.5-flash-native-audio-preview-12-2025`, `...-09-2025` (`App.vue`).
  - Analysis default: `gemini-2.5-pro` (`pro_client.py`); selectable `gemini-3.1-pro-preview`, `gemini-2.5-flash`, `gemini-3-flash-preview` (`App.vue`).
  - Note: `app.py /api/models` returns a *different, stale* list (`gemini-2.0-flash-live-001`, `gemini-3-flash-live-001`, `gemini-2.5-pro-preview-05-06`, etc.) that the frontend does not actually consume — the real lists are hard-coded in `App.vue`.
- **Ports:** read from a shared `../../ports.json` under key `CodeAssistant` (`{backend, frontend}`) by both `vite.config.js` and `app.py` (backend default 8005). The Vite dev server proxies `/ws` (websocket) and `/api` (HTTP) to the backend, so the browser only ever talks to the Vite origin.
- **Auth/secrets:** none for the app itself. `GOOGLE_API_KEY` loaded from `backend/.env` via `python-dotenv` (`load_dotenv(override=True)`).

---

## Media I/O

This is the heart of the app. Every channel:

### Video — screen share (input)
- `useVideoCapture.startScreenShare()`: `navigator.mediaDevices.getDisplayMedia({ video: { width:{ideal:1920}, height:{ideal:1080} }, audio:false })`. System audio is NOT captured. A track `onended` handler stops capture when the user ends sharing via the browser chrome.

### Video — webcam (input)
- `useVideoCapture.startCamera()`: `getUserMedia({ video:{ideal 1920x1080}, audio:false })`.
- Only one source active at a time; `startCamera`/`startScreenShare` each call `stop()` first. `sourceType` ref tracks `'camera' | 'screen' | 'none'`.
- The stream is rendered full-viewport as the app background (`VideoPassthrough.vue`, `<video autoplay playsinline muted>`); `srcObject` is set imperatively via a `watch` because Vue can't bind it declaratively.

### Video frame extraction → AI (input encoding)
- `useVideoCapture` draws the `<video>` onto an offscreen `<canvas>`, downscaling to max **1280×720** preserving aspect, then `canvas.toDataURL('image/jpeg', 0.7)` and strips the data-URI prefix to get raw **base64 JPEG** (`FRAME_QUALITY=0.7`, `FRAME_MAX_WIDTH/HEIGHT` in `constants.js`).
- `startFrameCapture(video, onFrame, fps)` runs a `setInterval` at the given fps; **Live mode streams at 2 fps** (`App.vue startFrameStreaming`).
- `captureScreenshot()` / `getCompositedCanvas()` produce **full-resolution** JPEG at quality **0.92** for deep analysis / OCR / region crop.

### Audio — microphone (input)
- `useAudioCapture.start()`: `getUserMedia({ audio:{ sampleRate:16000, channelCount:1, echoCancellation:true, noiseSuppression:true }})`.
- Processing via **`ScriptProcessorNode`** (chosen explicitly "for wide browser compatibility" — not AudioWorklet). Buffer size = next power-of-two for ~`AUDIO_CHUNK_MS=500ms` at 16 kHz, capped at 16384.
- In `onaudioprocess`: computes RMS into `audioLevel` (drives a UI meter), converts Float32 → **Int16 PCM** (little-endian, the standard `s<0 ? s*0x8000 : s*0x7fff`), then base64-encodes via `String.fromCharCode`/`btoa`. Each chunk is handed to a callback.
- In `App.vue toggleMic`, that callback calls `ws.sendAudio(base64)` **only while Live mode is active**.
- `AudioContext` is created at 16 kHz; source→processor→destination is connected (the destination connection is required for ScriptProcessor to fire).

### Audio — AI speech output (OUTPUT — present in backend, NOT played)
- Backend requests `response_modalities=["AUDIO"]` (`live_client.py`), receives `inline_data` audio parts, base64-encodes them and emits `{type:"audio_response", data}` over the WebSocket.
- **The frontend never registers an `audio_response` handler and has no playback path.** Verified by grep: `audio_response` appears only in backend code. So the model is configured to speak, but the spoken audio is silently dropped; Live mode only surfaces the streamed `text_response`. (Strong candidate for "fix in rebuild" — see Limitations.)

### System / loopback audio
- Not captured anywhere (`getDisplayMedia` is called with `audio:false`).

### Summary matrix
| Channel | Dir | How |
|---|---|---|
| Screen share | in | `getDisplayMedia` video-only, full-viewport `<video>` bg |
| Webcam | in | `getUserMedia` video-only |
| Video frames → AI | in | canvas→JPEG base64; 2 fps live / full-res for analysis |
| Microphone → AI | in | `getUserMedia` + ScriptProcessor → Int16 PCM 16 kHz base64 (live only) |
| AI speech | out | backend emits `audio_response`; **frontend drops it (no playback)** |
| System audio | — | not captured |

---

## AI Capabilities

### Live (realtime bidirectional) — `backend/gemini/live_client.py`
- `client.aio.live.connect(model, config=LiveConnectConfig(response_modalities=["AUDIO"], system_instruction=...))` opened as an async context manager; a background `_receive_loop` iterates `session.receive()`.
- **Inputs to model:**
  - Audio: `session.send_realtime_input(audio=Blob(data, mime_type="audio/pcm;rate=16000"))`.
  - Video frames: `session.send_realtime_input(video=Blob(data, mime_type="image/jpeg"))`.
  - Text turn: `session.send_client_content(turns=[Content(role=user, parts=[Part(text)])], turn_complete=True)`.
  - Multimodal turn (image+text): `send_client_content` with an inline-data Part + text Part.
- **Outputs from model:** iterates `response.server_content.model_turn.parts` → text parts and audio (`inline_data`, `audio/*`) parts; also signals `turn_complete`. Delivered to the WS route via `on_text` / `on_audio` / `on_turn_complete` callbacks.
- No function/tool calling, no grounding/search, no structured output — pure streaming chat over the feed.

### Deep Analysis (batch HTTP) — `backend/gemini/pro_client.py`
- `client.aio.models.generate_content(model, contents=[Content(user, parts)], config=GenerateContentConfig(system_instruction, temperature=0.3))`.
- Parts: optional inline JPEG (`Blob`, strips data-URI prefix) + text. Returns `response.text`.
- **Model comparison** endpoint runs the same prompt against two models in parallel via `asyncio.gather` (`/api/analyze/compare`) — defined but the frontend never calls it.

### Vision
- Both paths are vision-capable: live gets a 2 fps JPEG stream; analysis gets full-res JPEGs (screenshots, cropped regions, OCR captures, scroll-capture frames).

### System-prompt design
- **Live** (`App.vue buildSystemInstruction`, mirrored as fallback in `websocket.py`): *"You are CodeAssistant… watching the user's screen or camera feed in real-time. Provide helpful, concise responses about the code, errors, or development activity you observe. Be proactive about pointing out issues."*
- **Analysis** (`pro_client.py`): *"You are CodeAssistant, an expert AI development assistant. Analyze code, debug errors, explain concepts, and suggest improvements. Use markdown formatting. Be thorough but concise."*
- **Pinned context** is appended to either prompt as `"\n\nProject Context:\n{context}"` (passed as a WS query param for live; as a request field for analysis).
- Task-specific one-shot prompts are injected as the user message for OCR, region-analyze, scroll-capture, and the 8 templates (see Core Features).

---

## Core Features

1. **Dual-mode AI (Live vs Deep Analysis split).** Mutually exclusive: enabling one disconnects/closes the other (`App.vue toggleLiveMode`/`toggleAnalysisMode`). Live = WebSocket streaming 2 fps + mic; Analysis = HTTP one-shot with a chat-style conversation log. Each panel has its own model dropdown.
2. **Live frame + audio streaming.** While Live + a video source are active, frames stream at 2 fps; mic (if unmuted) streams Int16 PCM. A `watch` on `videoCapture.isActive` auto-starts/stops streaming. (`App.vue`)
3. **Deep analysis with image attach.** `DeepAnalysisPanel.vue`: textarea (Ctrl+Enter submit), 📸 "attach screenshot" button that composites the current frame, image preview chips, markdown answers, model selector. POSTs `/api/analyze`.
4. **OCR** (`App.vue handleOcr`): composites a full-res screenshot and sends a fixed "extract all text… use code blocks for code" prompt to the analysis model; result is appended to the analysis conversation.
5. **Region select → auto-analyze** (`AnnotationCanvas` mode `'region'` + `App.vue handleRegionSelected`): drag a rectangle (dimmed mask + dashed border + corner handles drawn on canvas); on mouseup (min 20×20px) it crops that rect out of the **rotation-composited** canvas (accounting for `getBoundingClientRect` scale), base64-encodes, and auto-submits *"Analyze this selected code region…"*.
6. **Scroll Capture** (`App.vue toggleScrollMode`/`processScrollCapture`): toggling on captures frames at **5 fps** into an array while the user scrolls a document; toggling off samples up to ~5 representative frames and sends the middle one with a prompt to *"reconstruct the full text/logic… discard overlaps."* The reconstruction is **auto-saved into pinnedContext** and localStorage. (Note: only one image is actually sent to the model, despite the multi-frame framing.)
7. **Freehand annotations** (`AnnotationCanvas` mode `'draw'`): full-viewport transparent canvas, pointer-events toggle by mode; freehand polyline paths persisted and redrawn on resize. `getCompositedCanvas()` overlays the annotation canvas onto the (rotated) video before any screenshot, so drawings are included in what the AI sees.
8. **Prompt templates** (`PromptTemplates.vue` + `PROMPT_TEMPLATES` in `constants.js`): 8 quick actions (Review, Explain, Fix Error, Optimize, Suggest Tests, Refactor, Security Check, Generate Docs). In Live mode a template is sent as a chat message; otherwise it captures a screenshot and fires a deep-analysis request.
9. **Video rotation** (`handleRotate`): rotates the background `<video>` via CSS in 90° steps; `getCompositedCanvas` re-derives canvas dimensions and applies the same rotation so captures match what's shown.
10. **Source switching** (`OverlayControls cycleSource`): one button cycles camera ↔ screen.
11. **Pinned project context + persisted settings** (`SettingsPanel.vue`): pinned context textarea, live/analysis model overrides (free-text), frame-rate number, JPEG-quality slider. Saved to `localStorage` key `codeassistant-settings`. Changing settings while Live is active reconnects the WS with the new model/instruction.

---

## UI / UX

- **Layered fullscreen layout** (`App.vue` template), z-ordered: (0) full-viewport video background → (40) annotation/region canvas → (50–90) panels → (100) overlay control bar.
- **Glassmorphism dark theme**: design-token CSS (`styles.css`) — `--bg-glass`, `backdrop-filter: blur(20/40px)`, gradient buttons (`btn-primary` blue→purple, `btn-live` green→blue), glowing status dots, custom scrollbars, CSS-only `[data-tooltip]` tooltips, keyframe animations (pulse, dot-wave streaming indicator, spinner, mic-pulse, slide-ins).
- **Floating overlay control bar** (`OverlayControls.vue`): bottom-center, **draggable** via a ⠿ handle and **double-click-to-minimize**. Groups: connection status + source; center mode toggles (⚡ Live / 🔬 Analyze / 📄 OCR); right tools (🎙️ mic w/ live audio-level bar, ✏️ annotate, ⬜ region, 📋 templates, 🔄 rotate, 📜 scroll, ⚙️ settings).
- **Draggable + resizable panels**: `useDraggable.js` (header acts as drag handle, ignores clicks on buttons/inputs/`.no-drag`, optional axis lock, cursor grab/grabbing, reset on close). `LiveResponsePanel` and `DeepAnalysisPanel` are also CSS `resize: both`. Position resets when a panel closes.
- **Chat-style transcripts** in both panels with role labels, markdown via `marked` (`v-html`, `breaks:true`), image thumbnails for user-sent images, streaming dot-wave indicator (live) / spinner (analysis), auto-scroll on new messages.
- **Connection status** label adapts: shows "HTTP Connected" in analysis mode vs Live Connected/Connecting/Disconnected with colored dot.
- **No-source placeholder**: animated 📹 with Camera / Screen Share buttons.

### OS/UX integration — explicitly absent
This runs as a **plain browser web app** (Vite + FastAPI). There is **no** Electron/Tauri shell, so: no true OS always-on-top, no click-through, no global hotkeys, no system tray, no cursor/screen control, no multi-monitor APIs. "Always on top" / "overlay" / "draggable windows" are all **in-page** (z-index + JS drag) over the captured feed, not OS-level. A rebuild wanting a real screen overlay would need a desktop shell.

---

## Backend Services

- **`app.py`** — FastAPI app; CORS `*`; mounts the two routers; `/health`; `/api/models` (stale, unused list); reads port from `ports.json`; `uvicorn.run(reload=True)`.
- **`routes/websocket.py`** — `GET /ws/live` WebSocket. Reads `model`, `system_instruction`, `context` query params, builds the live system instruction (+ pinned context), creates a `GeminiLiveClient`, wires `on_text/on_audio/on_turn_complete` → `send_json`, then loops `receive_text()` dispatching client message types to the Gemini client. One Gemini Live session **per WS connection**; cleaned up in `finally`.
- **`routes/analysis.py`** — `POST /api/analyze` (text+optional image+model+context+system_instruction → `{response, model}`) and `POST /api/analyze/compare` (two models in parallel → both responses). Uses a lazily-created shared `GeminiProClient`.
- **`gemini/live_client.py`** — `GeminiLiveClient`: connect/disconnect, `send_audio[_base64]`, `send_image_base64`, `send_text`, `send_multimodal`; receive loop parsing text/audio parts + turn-complete; `_safe_callback` awaits coroutine callbacks.
- **`gemini/pro_client.py`** — `GeminiProClient.analyze()`: builds system instruction (+context), inline image + text parts, `generate_content` at `temperature=0.3`, returns text or an error string.

### WebSocket protocol
**Client → server:** `{type:"audio", data:b64}`, `{type:"video_frame", data:b64}`, `{type:"text", data:str}`, `{type:"multimodal", text, image}`, `{type:"config", ...}` (no-op).
**Server → client:** `{type:"status", data}`, `{type:"text_response", data}`, `{type:"audio_response", data:b64}` (unused by client), `{type:"turn_complete"}`, `{type:"error", data}`.

---

## Data / Persistence

- **No database, no server-side storage, no auth, no transcript persistence.** Conversations live only in Vue refs and vanish on reload/clear.
- **`localStorage['codeassistant-settings']`** — the only persistence: `{pinnedContext, liveModel, analysisModel, frameRate, jpegQuality}`. Loaded on mount in both `App.vue` and `SettingsPanel.vue`.
- **Pinned context** doubles as a lightweight "context bank" — and scroll-capture writes its reconstructed text back into it.
- **`backend/.env`** — `GOOGLE_API_KEY` only. **`../../ports.json`** — shared port registry (suggests a multi-app monorepo of "Assistants").

---

## Reusable Patterns (worth carrying into a rebuild)

- **Backend as a thin Gemini-Live proxy** over a single normalized JSON WebSocket envelope (`{type, data}`), keeping the API key server-side and giving the browser one origin (Vite proxies `/ws` + `/api`).
- **Two-tier AI split**: cheap realtime streaming model for ambient commentary vs. expensive Pro model for deliberate one-shot deep analysis — distinct transports (WS vs HTTP), distinct UIs.
- **Composable media layer**: `useVideoCapture` / `useAudioCapture` / `useWebSocket` cleanly separate capture, encoding, and transport; each self-cleans via `onUnmounted`.
- **Composited capture pipeline** (`getCompositedCanvas`): single function that bakes CSS rotation + annotation overlay into one canvas, reused by screenshot/OCR/region-crop/templates so "what the AI sees" always equals "what the user sees + drew."
- **Region-crop math** that maps a screen-space rectangle back into the rotated source canvas via `getBoundingClientRect` scale factors.
- **In-page draggable/minimizable/resizable overlay** without a desktop shell (`useDraggable` + z-index layering + glass CSS).
- **Frame downscale + JPEG-quality knobs** to bound realtime bandwidth (1280×720 @ q0.7 @ 2 fps).
- **Standard ScriptProcessor PCM16 mic pipeline** (Float32→Int16 LE→base64, RMS level meter) — portable building block.
- **Prompt templates as data** (`constants.js`) routed differently per mode (live message vs screenshot+analyze).

---

## Limitations / Tech Debt

- **AI voice output is dead-ended.** Live API is configured `response_modalities=["AUDIO"]` and the backend forwards `audio_response`, but the frontend has no handler and no audio-playback code, so the model's speech is dropped. Either switch the live config to TEXT, or add a 24 kHz PCM playback path (AudioWorklet/`AudioBufferSourceNode`) on the client.
- **`ScriptProcessorNode` is deprecated.** Replace with an `AudioWorklet` for the mic path.
- **Scroll capture oversells itself.** It collects many frames but only sends a single middle frame to the model; the "combine N frames chronologically" prompt can't be honored. A rebuild should send the sampled frames as multiple image parts (or use the video/file API).
- **Model lists are duplicated/stale.** `/api/models` (backend) and the hard-coded arrays in `App.vue` disagree; `SettingsPanel` placeholders cite yet other model names. Centralize.
- **No persistence/history/auth.** Transcripts and analyses are ephemeral; no export, no project workspaces beyond a single pinned-context blob.
- **No tool/function calling or grounding** — the assistant can only talk about what's on screen; it can't read files, run code, search, or act.
- **CORS `*`** and an API key in `.env` with the backend bound to `0.0.0.0` — fine for local dev, not for shipping.
- **WebSocket auto-reconnect** can resurrect a session the user intended to stop (only suppressed on close code 1000); config/system-instruction sent only as connect-time query params (no runtime updates — `config` message is a no-op).
- **Single concurrent video source**; no multi-monitor selection beyond what the browser's `getDisplayMedia` picker offers.
- **`/api/analyze/compare`** and `captureFrame`/several exposed helpers exist but are unused — partial features.
- **No tests, no error toasts** (errors mostly `console.error` or appended as a ⚠️ chat line).

---

## Unique Value (vs sibling assistants)

CodeAssistant is the **"AI looking over your shoulder at the screen"** tool. Its differentiators:
- **Live screen/camera feed as the primary input** with **continuous 2 fps streaming** to a realtime Gemini model — ambient, proactive code commentary rather than request/response only.
- **Two cleanly separated AI tiers** (realtime Live vs deep Pro) selectable per interaction.
- A **capture toolkit purpose-built for code on a screen**: OCR, drag-to-select-a-code-region → auto-analyze, scroll-capture-to-context, and freehand annotations that are baked into the image sent to the AI.
- An **in-browser floating glass overlay** (draggable, minimizable, resizable panels) that mimics a desktop HUD without needing Electron.
