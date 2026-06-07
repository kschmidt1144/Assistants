# Live_Assistant — Functionality Inventory

> Source: `/Users/kevinschmidt/Repos/OldAssistants/Live_Assistant`
> Stack: React 18 + Vite frontend, FastAPI backend, dual-model AI (Gemini Live API for realtime + Claude/Gemini for batch analysis). This is the most advanced of the assistants: speaker identification, voice profiles, live transcription, media recording, screen/camera/capture-card capture, cursor + display control, draggable overlay windows, interview prep with TTS.

---

## Purpose
A real-time multimodal "co-pilot" that watches your screen/camera and listens to your mic (and optionally system/loopback audio), then assists live in three task modes:
- **Meeting** — live transcription, AI note-taking, running summaries, action-item tracking, recording, transcript history.
- **Code** — analyzes screen-shared/captured code, finds bugs, explains, suggests fixes.
- **Interview** — real-time interview coaching (concise key points to hit), plus a "Practice" sub-mode with TTS-spoken questions and AI answer feedback, a pre-interview checklist, and screen "passthrough" cursor control.

There is also a **1080p overlay mode**: a full-viewport video background with floating, draggable, resizable glass windows (controls / AI chat / transcript / deep-analysis) intended to sit on top of a shared screen.

---

## Tech Stack

### Frontend (`frontend/`)
- **React 18.2** (`react`, `react-dom`), **Vite 5** dev server.
- `@vitejs/plugin-basic-ssl` — dev server runs over **HTTPS** (required for `getUserMedia`/`getDisplayMedia` and Web Speech). `vite.config.js` proxies `/ws` to the backend and reads ports from `../../ports.json`.
- **react-markdown 10** + **remark-gfm 4** + **react-syntax-highlighter 16** (Prism `oneDark`) for rich AI output rendering.
- No state library, no router — single `App.jsx` (~2,334 lines) holds all state; logic split into 6 custom hooks + 5 components.

### Backend (`backend/`)
- **FastAPI 0.109** + **uvicorn[standard]** (`app.py`). CORS wide-open (`allow_origins=["*"]`).
- **google-genai 1.0.0** — official Google GenAI SDK; used both for **Gemini Live** bidirectional streaming (`client.aio.live.connect`) and for non-streaming `generate_content` (analysis, transcript refine/clean, TTS, interview feedback).
- **httpx** — direct HTTP client for the **Anthropic Claude** Messages API (`backend/claude/client.py`); supports streaming and non-streaming.
- **resemblyzer + torch + torchaudio + librosa + soundfile** — speaker embedding / voice verification (`backend/voice_profile.py`), with an MFCC fallback if resemblyzer is unavailable.
- **pyautogui + screeninfo** — system cursor control & monitor enumeration (`backend/cursor_control.py`).
- Windows **DisplaySwitch.exe** via `subprocess` — toggle monitor layout (`backend/display_control.py`).
- `python-dotenv` — loads `.env` (with `override=True`).

### AI models referenced in code (NOTE: prototype values — many are placeholder/aspirational IDs that do not all exist; see Limitations)
- Realtime (Gemini Live default): `gemini-2.0-flash-live-001` (`backend/gemini/client.py` `MODEL`). WebSocket also defaults to `models/gemini-2.0-flash-exp` if a `config` message omits the model.
- Frontend model picker (`App.jsx` `availableModels`): `gemini-3.1-pro-preview`, `gemini-3-flash`, `gemini-2.5-pro-preview-06-05`, `gemini-2.0-flash-live-001`, `gemini-1.5-flash`, `gemini-1.5-pro`, plus Claude: `claude-sonnet-4-20250514`, `claude-opus-4-20250514`, `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`.
- Deep-analysis default: `gemini-3.1-pro-preview` (`routes/analysis.py`, `AnalyzeRequest.model`).
- Transcript refine: `gemini-3-flash` (`routes/transcription.py`). Transcript clean default: `gemini-3.1-pro-preview` (`routes/transcripts.py`).
- TTS: `gemini-2.5-flash-preview-tts` (`backend/interview_prep.py`), voices `Kore, Charon, Fenrir, Aoede, Puck`.
- Interview feedback: `gemini-3-flash` (`backend/interview_prep.py`).
- Claude client model map (`backend/claude/client.py`): sonnet-4 / opus-4 / 3.7-sonnet / 3.5-sonnet / 3.5-haiku (dated IDs).

---

## Media I/O (the heart of the app)

### 1. Microphone → Gemini (realtime PCM16) — `frontend/src/hooks/useAudioCapture.js`
- Creates `AudioContext({ sampleRate: 16000 })`.
- `getUserMedia({ audio: { channelCount:1, sampleRate:16000, echoCancellation, noiseSuppression, autoGainControl } })`.
- Uses a **`ScriptProcessorNode`** (`createScriptProcessor(4096, 1, 1)`); in `onaudioprocess`, reads channel-0 `Float32Array`, converts to **16-bit PCM** (`float32ToPCM16`), then **base64** (`arrayBufferToBase64`), and calls `onAudioData` → `sendAudio` over WebSocket as `{type:"audio", data}`.
- Processor is connected to a **muted gain node** → destination so the browser doesn't GC it (and we don't hear ourselves).
- An `AnalyserNode` (fftSize 256) drives a live mic level meter via `requestAnimationFrame`.

### 2. System / loopback audio (mixed with mic) — same hook
- When `startCapture({ captureSystemAudio:true })`: calls `getDisplayMedia({ video:true, audio:{ echoCancellation:false,... } })` (video must be requested to get a system-audio track in most browsers).
- The system-audio `MediaStreamSource` is routed through a `GainNode` (gain 1.0) and **connected to the same `ScriptProcessor`** as the mic — Web Audio auto-mixes both into one PCM stream sent to Gemini. Both sources also feed the analyser.
- UI exposes a "Sys On/Off" toggle (`includeSystemAudio`) in Interview mode; recommends headphones to avoid echo.

### 3. Backend audio → Gemini Live — `backend/gemini/client.py`
- `send_audio_base64` / `send_audio` call `session.send_realtime_input(audio=types.Blob(data, mime_type="audio/pcm;rate=16000"))`.

### 4. Webcam / screen / capture-card video → JPEG frames — `frontend/src/hooks/useVideoCapture.js`
- **Camera:** `getUserMedia({ video:{ width:1920, height:1080, facingMode:'user' } })`.
- **Specific device** (`startDevice(deviceId)`): `getUserMedia({ video:{ deviceId:{exact}, 1920x1080 } })` — explicitly designed for **external capture cards (Elgato HD60 X)**; devices enumerated via `enumerateDevices()` (with `devicechange` listener).
- **Screen share:** `getDisplayMedia({ video:1920x1080 })`; reads `videoTrack.getSettings().displaySurface` to label source (🖥️ monitor / 🪟 window / 🌐 browser) and registers `onended` to auto-stop.
- **Frame capture:** `captureFrame(crop?)` draws the `<video>` to an offscreen `<canvas>` (optionally a crop region `{x,y,w,h}`) and returns base64 **JPEG (quality 0.99)** (prefix stripped). Sent as `image` or `multimodal` over WS, or POSTed to `/analysis/analyze`.

### 5. Backend image → Gemini Live — `backend/gemini/client.py`
- `send_image_base64` → `session.send_realtime_input(video=types.Blob(data, "image/jpeg"))`.
- `send_multimodal(text, image)` → `session.send_client_content(turns=[Content(role=user, parts=[image, text])], turn_complete=True)`.

### 6. AI audio OUT (Gemini Live audio responses) — partially wired
- Gemini client parses `inline_data` audio parts and base64-encodes them to an `on_audio` callback → WS `{type:"audio", data}` (`routes/websocket.py`). Frontend `useWebSocket` has an `onAudio` slot but App.jsx **does not currently play live AI audio** (Live session is configured `response_modalities=["TEXT"]`). Hook for audio out exists but is dormant.

### 7. TTS audio OUT (interview questions) — `backend/interview_prep.py` + `App.jsx`
- `generate_question_audio(text, voice)` calls Gemini `gemini-2.5-flash-preview-tts` with `response_modalities=["AUDIO"]` + `SpeechConfig(PrebuiltVoiceConfig(voice_name))`, returns base64 WAV. Sent over WS as `question_audio`.
- Frontend decodes base64 → `Blob` → `URL.createObjectURL` → hidden `<audio>` element with play/pause.

### 8. Audio/Video recording (download) — `frontend/src/hooks/useMediaRecorder.js`
- Audio: `getUserMedia` → `MediaRecorder('audio/webm;codecs=opus')`, 1s chunks, export `.webm`.
- Video: `MediaRecorder(videoStream, 'video/webm;codecs=vp9')`, export `.webm`. (Video record wiring present in hook; UI exposes audio record + conditional video export.)

### 9. Speech-to-text (browser) — `frontend/src/hooks/useSpeechTranscription.js`
- **Web Speech API** (`webkitSpeechRecognition`), `continuous + interimResults`, `lang='en-US'`. Auto-restarts on `onend` (with retry). Produces timestamped entries `{id, text, timestamp, speaker}`; exposes interim text. Export as TXT/MD, save/load to **localStorage**.

### 10. Speaker-ID audio loop (separate channel) — `frontend/src/hooks/useSpeakerIdentification.js`
- While transcribing+connected, runs an independent loop: `getUserMedia(audio)` → `MediaRecorder('audio/webm;codecs=opus')` recording **2.5-second segments**, base64-encodes each blob, sends WS `{type:"identify_speaker", audio}`; backend returns `speaker_identity`. Loop re-arms after each `onstop`.

---

## AI Capabilities

### Realtime streaming (Gemini Live) — `backend/gemini/client.py`, `routes/websocket.py`
- Persistent session via `client.aio.live.connect(model, config)` inside an async context manager; a background `_receive_loop` iterates `session.receive()`.
- `GenerateContentConfig(response_modalities=["TEXT"], system_instruction=...)`; optional `ThinkingConfig(thinking_budget=-1 for HIGH else 1024)`.
- Streams **text deltas** back to the client token-by-token via `on_text` → WS `text`; `turn_complete` → WS `turnComplete`. Frontend appends deltas into the in-progress assistant message and marks `complete` on turn end.
- Inputs supported live: audio (PCM16), image (JPEG), text, and text+image multimodal.

### Batch / high-reasoning analysis — `routes/analysis.py`
- `POST /analysis/analyze {image, context, model, thinking_level}`. Routes by prefix: `claude-*` → `ClaudeClient.send_message` (vision); else Gemini `generate_content` with optional `ThinkingConfig(thinking_level=...)`. Returns markdown `analysis`. Frontend "🔬 Analyze" can crop to `left`/`right`/`full` region before sending.

### Claude client — `backend/claude/client.py`
- Raw httpx to `https://api.anthropic.com/v1/messages`, header `anthropic-version: 2023-06-01`. Supports image+text content blocks; streaming via SSE (`content_block_delta`/`text_delta`) when an `on_text` callback is supplied, else sync. `max_tokens` default 4096.

### Transcript AI — `routes/transcription.py`, `routes/transcripts.py`
- `POST /transcription/refine` — Gemini cleans raw transcription text (grammar, fillers, paragraphs), returns markdown.
- `POST /transcripts/clean {transcript_id, model}` — formats stored entries as `[ts] Speaker: text`, asks Gemini or Claude to clean while preserving the format, then **parses the response back into structured entries** and returns both raw + parsed + counts.

### Interview prep AI — `backend/interview_prep.py`
- Static **question bank** (behavioral/technical/situational, each with tips).
- TTS generation (above) with a "professional interviewer" wrapper prompt.
- `get_answer_feedback(question, answer)` — Gemini coach prompt → markdown (Strengths / Areas for Improvement / Sample Enhancement).

### System-prompt design — `App.jsx getSystemPrompt(mode)`
Per-mode prompts are assembled client-side and sent in the WS `config`:
- **Meeting:** composes topic + behavior (silent/proactive/summary) + assist mode (auto/manual) + capabilities + a strict markdown response format (action items as `**Action:** ... - *Owner: ...*`, summary headings).
- **Code:** language/framework ID, bug-finding, mandatory fenced code blocks with language tags, notes the model can also hear the user.
- **Interview:** terse real-time coach — 3-5 action-verb bullets, no full answers, no meta; appends uploaded context docs (resume/JD).
- **Default:** generic helpful assistant with markdown.

---

## UI / UX Features

- **Three task modes** with distinct layouts: Meeting = 3-panel (Transcription / AI Output / Summary); Code = video + chat sidebar; Interview = fullscreen-capable screen view + coaching/practice sidebar.
- **1080p overlay mode** (`render1080pMode`): full-viewport `<video>` background + floating `DraggableWindow`s (Controls, AI Assistant, Transcript, Deep Analysis). Right-click toggles overlay visibility. Per-window show/hide toggles. (`frontend/src/components/DraggableWindow.jsx`)
- **DraggableWindow:** glassmorphism (backdrop-blur), drag by header, resize handle (min 200×100), maximize/restore, optional close. Pure mouse-event implementation.
- **CropModal** (`components/CropModal.jsx`): draws snapshot to canvas, drag a selection rectangle (dashed purple, dims outside), rescales selection to original coords, exports cropped JPEG; falls back to full image if no selection.
- **MarkdownRenderer** (`components/MarkdownRenderer.jsx`): compact dense styling; code blocks get a header bar (language + line count, **copy** button, **collapse/expand** when >8 lines) with Prism `oneDark`; clickable/zoomable images (lightbox); styled tables, links (new tab), blockquotes.
- **Fullscreen + passthrough (Interview):** `requestFullscreen` on the container; clicking the screen toggles "passthrough mode" (intended to forward cursor to a shared screen). `fullscreenchange` listener resets state on Escape.
- **Pre-interview checklist:** two-section (setup/prep) checkbox list with progress counter and reset.
- **Meeting extras:** topic field, behavior + assist toggles, live elapsed timer, Get Summary / Get Actions quick actions, Export Notes (markdown download), recording + transcription controls, select-text-to-"Ask AI", clickable transcript entries.
- **TranscriptManagerModal** (`components/TranscriptManagerModal.jsx`): list/detail/edit views over backend-saved transcripts — rename, edit entries (speaker/text/delete), delete, **AI Clean** (model dropdown) with apply-cleaned-version, load.
- **VoiceProfileModal** (`components/VoiceProfileModal.jsx` + `.css`): guided 3-prompt enrollment (pangram / tongue-twister / counting), auto-stop per prompt, live level bar, sends all samples as `save_voice_profile`. Interview sidebar has a "Filter my voice (AI ignores me)" toggle (`filterUserVoice`).
- **Snap confirmations**, expanded-video modal, crop-mode toggle, device-selection dropdown, mic level meter, status indicators.

---

## Backend Services & WebSocket Protocol

### WebSocket `/ws` — `backend/routes/websocket.py`
One Gemini Live session per connection; auto-connects on first data if no `config` was sent.

**Client → Server:** `config` (systemPrompt, model, thinkingLevel), `audio`, `image`, `text`, `multimodal`, `cursor_move {x,y}`, `get_monitors`, `save_voice_profile`, `list_voice_profiles`, `delete_voice_profile`, `check_voice_match`, `identify_speaker`, `set_display_mode`, `hide_secondary_monitor`, `show_all_monitors`, `get_interview_categories`, `get_interview_questions`, `generate_question_audio`, `get_answer_feedback`, `get_interviewer_voices`.

**Server → Client:** `connected`, `ready`, `text`, `audio`, `turnComplete`, `imageSent`, `error`, `monitors`, `voice_profile_saved`, `voice_profiles`, `voice_profile_deleted`, `voice_match_result`, `speaker_identity`, `display_mode_changed`, `interview_categories`, `interview_questions`, `question_audio`, `answer_feedback`, `interviewer_voices`.

### REST routes
- `GET /health`, `GET /` (`app.py`).
- `POST /analysis/analyze` (`routes/analysis.py`).
- `POST /transcription/refine` (`routes/transcription.py`).
- `/transcripts` CRUD (`routes/transcripts.py`): `GET /`, `POST /`, `GET /{id}`, `DELETE /{id}`, `PUT /{id}/name`, `PUT /{id}/content`, `POST /clean`.

### Voice profile service — `backend/voice_profile.py`
- resemblyzer `VoiceEncoder` singleton; `preprocess_wav` + `embed_utterance`. Fallback = MFCC mean (librosa) padded to 256 dims. base64/bytes → wav via soundfile + librosa resample to 16k mono.
- `save_voice_profile` averages embeddings from multiple samples → JSON in `backend/voice_profiles/{name}.json`. `match_voice` / `identify_speaker` use cosine similarity vs threshold (default 0.75); `identify_speaker` scans all profiles and returns best match or "Unknown".

### Cursor / display control
- `cursor_control.py`: `get_all_monitors` (screeninfo), `move_cursor_to_screen(rel_x, rel_y → secondary monitor)` (pyautogui, FAILSAFE off, PAUSE 0), `click_at_position`.
- `display_control.py`: `set_display_mode(internal|extend|clone|external)` via `DisplaySwitch.exe` (Windows-only), plus `hide_secondary_monitor`/`show_all_monitors` — used to hide a second monitor during screen sharing.

---

## Data / Persistence
- **Transcripts:** JSON files in `backend/transcripts/{uuid}.json` via `transcript_manager.py` (Pydantic `Transcript` model: id, name, created_at, updated_at, content[{text,timestamp,speaker}]). Listing sorts by `updated_at` desc. (Sample files present.)
- **Voice profiles:** JSON files in `backend/voice_profiles/{name}.json` (name, embedding[], num_samples, created).
- **Browser localStorage:** live Web-Speech transcript save/load (`useSpeechTranscription`).
- **Context files (Interview):** uploaded resume/JD read client-side via `File.text()` (sliced to 10 000 chars), injected into the system prompt — never persisted.
- **Secrets:** `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY` from `.env`.
- **No auth, no database, no user accounts.** State is per-process / per-browser.

---

## Reusable Patterns (worth carrying into a rebuild)
1. **Web Audio mixing of mic + system audio into one PCM16 stream** for a single Live model input (gain nodes → shared ScriptProcessor) — `useAudioCapture.js`.
2. **WebSocket-as-proxy to a realtime LLM**: browser never holds the model key; backend owns the Gemini Live session and relays text deltas / turn-complete. Clean callback-based fan-out (`on_text/on_audio/on_turn_complete`).
3. **Dual-model split**: cheap/fast realtime model for the live loop + a separate high-reasoning "Deep Analyze" call (Gemini or Claude) on a single captured frame — decouples latency from depth.
4. **Provider-agnostic routing by model-ID prefix** (`claude-*` vs Gemini) reused across analyze/clean.
5. **Canvas snapshot + crop pipeline** (`captureFrame(crop)` + `CropModal`) to send only the relevant screen region to vision.
6. **Speaker enrollment + cosine-similarity identification** with a graceful MFCC fallback when the heavy model (resemblyzer/torch) is missing.
7. **Floating glass overlay windows** (drag/resize/maximize, pure DOM events) — strong base for an always-on-top assistant overlay.
8. **AI transcript cleaning that round-trips structured entries** (format → LLM → re-parse to entries + diff counts).
9. **Per-mode system-prompt composition** from UI toggles (behavior/assist/topic/context docs).
10. **Separate short-segment MediaRecorder loop** for speaker-ID, independent of the main PCM stream.

---

## Limitations / Tech Debt
- **Model IDs are largely placeholder/aspirational** and inconsistent: e.g. `gemini-3.1-pro-preview`, `gemini-3-flash` (used for refine/feedback/clean defaults) are not real public model names; Claude IDs are dated `*-20250514`/`2024…` strings. A rebuild should map all of these to current real models (e.g. current Claude Opus/Sonnet, current Gemini Live + a real high-reasoning Gemini).
- **Hardcoded `http://localhost:8001`** in 8 frontend fetch calls (analysis, transcripts CRUD/clean) and the dev WS URL — but `app.py` defaults to port **8004** from `ports.json` and `vite.config.js` proxies via ports.json. The hardcoded 8001 will break unless the backend happens to run on 8001. `ports.json` was not found at the expected repo-parent path during analysis.
- **Live AI audio output is dormant** — Live session is TEXT-only; the `on_audio`/`onAudio` plumbing exists but nothing plays it. No barge-in/voice-out conversation.
- **`ScriptProcessorNode` is deprecated** (should be `AudioWorklet`); runs on the main thread.
- **Speaker-ID sends WebM/Opus** blobs to a backend that decodes via soundfile/librosa — WebM/Opus is not reliably decodable by `soundfile`; identification likely depends on the MFCC fallback and may be unreliable. Profiles are also enrolled from WebM samples. No in-memory profile caching (TODO noted in code).
- **`display_control.py` is Windows-only** (`DisplaySwitch.exe`) while the project otherwise targets macOS/cross-platform; cursor passthrough relies on a system-level secondary monitor and pyautogui running on the same host as the browser.
- **Speaker name not fed into transcription** — `useSpeechTranscription` defaults speaker to "Speaker"/"User"; the identified speaker from the backend (`currentSpeaker`) is tracked but not wired into transcript entries.
- **CORS `*`**, no auth, no rate limiting; single global `active_connections` dict.
- **No real PDF/DOCX parsing** — "Add Resume" uses `File.text()`, so binary docs upload as garbage; only .txt/.md are meaningful.
- Some UI (video recording start button, `check_voice_match`, `cursor_move`, several Live-coach interviewer-question features) is partially wired or unused.

---

## Unique Value (vs the other assistants)
Live_Assistant is the only one combining **(a) realtime bidirectional Gemini Live streaming** of mixed **mic + system/loopback audio + screen/camera/capture-card video**, **(b) speaker identification via voice embeddings** (resemblyzer/torch with enrollment profiles), **(c) browser live transcription with persistent, AI-cleanable transcript history**, **(d) OS-level cursor + multi-monitor display control** for screen-share scenarios, **(e) a draggable glass overlay ("1080p") mode**, and **(f) a full interview suite** (real-time coaching + TTS practice questions + AI answer feedback + checklist). It is effectively a meeting/interview/coding "screen co-pilot" with the deepest media + OS integration of the set.
