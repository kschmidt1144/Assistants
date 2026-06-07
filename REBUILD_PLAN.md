# Assistants — Clean-Room Rebuild Plan

> **Status:** Draft v3 · **Date:** 2026-06-07 · **Owner:** Kevin
> **Goal:** Recreate the capabilities of the old prototype assistants (`~/Repos/OldAssistants`) as **several focused assistants built on one shared core**, cleaner and with current AI models. We are **not** copying the old implementation — we're carrying forward *what* each did and the patterns worth keeping, and fixing the accumulated tech debt.
>
> **v2 change:** dropped the **Interview Copilot** entirely and removed **job-board scraping** (§1.1).
> **v3 change:** locked the open decisions (§1.2) — three browser-based apps (Coding, Meeting, Jobs), React 19 + TS, **no desktop shell**, **Gemini Live + Claude only**, **Meeting is local-only** (no Firebase/Cloud Run). **All eight decisions are now locked** — #7 diarization = local voice-embeddings, #8 Gemini Live = native-audio (Option B). See §1.2.
>
> This is a living document — edit freely. Per-prototype deep-dive inventories live in `./analysis/*.md`.
> Conventions: **[DECISION]** = needs your call · ✅ = locked · `[ ]` = roadmap checkbox · ⚠️ = risk/known debt.

---

## 1. Executive summary

The old `OldAssistants` folder holds **5 prototypes**. Here's what each is and what we carry forward:

| Prototype | What it really is | Realtime? | Carried forward as |
|---|---|---|---|
| `codeassistant` | Screen/camera-watching coding helper (live commentary + deep analysis + capture toolkit) | ✅ Gemini Live | → **Coding Copilot** |
| `Live_Assistant` | All-purpose co-pilot: Meeting + Code + Interview modes, speaker-ID, transcript history, cursor/display control, overlay | ✅ Gemini Live + Claude | → **split** into Coding + Meeting (interview mode dropped) |
| `Meeting_Assistant` | Cloud-deployed (Firebase + Cloud Run) realtime voice→text skeleton w/ auth | ✅ Gemini Live | → **Meeting Copilot** *(local-only; cloud/auth skeleton deferred — §1.2 #6)* |
| `jobapplicationassistant` | Job-search pipeline: scraping, tracker, resume engine | ❌ batch only | → **Job Application Assistant** *(scraping removed)* |
| `interview_assistant` | Live dual-speaker interview copilot + stealth overlay | ✅ Gemini Live | → ❌ **dropped (sensitive)** |

They share **~70% of their plumbing** (browser PCM16 capture → WebSocket → Gemini Live → streamed text; FastAPI key-hiding proxy; glassmorphism UI; dual-model "realtime + deep analysis" split) and each re-implements it slightly differently, with the same recurring debt (deprecated `ScriptProcessorNode`, hardcoded/stale model IDs, brittle JSON parsing, no persistence, in-browser-faked overlays, Windows-only OS hooks).

**The plan:** build **three focused, browser-based apps on a shared core**:

1. **Coding Copilot** — screen-aware coding help
2. **Meeting Copilot** — meeting transcription, notes, summaries (local-only)
3. **Job Application Assistant** — resume & application pipeline, manual job intake (no scraping)

…all sitting on a **Shared Core** (media capture, realtime/reasoning provider clients, transcription + diarization, in-page overlay UI kit, local persistence). This is the "multiple focused assistants instead of one all-purpose" outcome you asked for, without re-writing the same media stack three times.

### 1.1 Explicitly out of scope (deliberately removed)

| Removed | Why | Knock-on removals |
|---|---|---|
| **Interview Copilot** (the whole app) | Covert assistance during live interviews + screen-capture invisibility is deceptive; you chose to drop it. | Hint agent, prep bank, practice mode, interview question detection — all gone. |
| **Screen-capture exclusion / "stealth" overlay** | Its only real purpose was hiding AI help from an interviewer during screen-share. | Dropped. Normal (visible) in-page overlay stays. |
| **Job-board scraping** (Indeed/LinkedIn/ZipRecruiter) | Fragile, often violates site ToS, and the anti-bot/stealth apparatus is the sketchy part. | Stealth/anti-bot/CAPTCHA handling, persistent-profile platform login, "view listing authenticated", and autofill-DB seeding all go with it. Jobs are entered manually (paste URL/JD). |

> These can be revisited later, but the rebuild assumes they're out. The old inventories (`analysis/interview_assistant.md`, scraping parts of `analysis/jobapplicationassistant.md`) remain as reference only.

### 1.2 Locked decisions (v3)

| # | Decision | Locked choice | Main consequence |
|---|---|---|---|
| 1 | Overall shape | ✅ focused-apps-on-shared-core | monorepo; build the core once |
| 2 | Build order | ✅ Core → Coding → Meeting, Jobs in parallel | see §9 roadmap |
| 3 | Frontend framework | ✅ **React 19 + TypeScript** | one UI kit; no Vue |
| 4 | Desktop shell | ✅ **None** (browser apps) | overlay is **in-page**; **no** true OS overlay / global hotkeys / system tray / cursor & display control in v1 |
| 5 | Provider posture | ✅ **Gemini Live + Claude only** | no Deepgram/AssemblyAI/OpenAI; narrows #7 to local embeddings |
| 6 | Meeting hosting | ✅ **Local-only** | no Firebase auth, no Cloud Run/Terraform; local FastAPI + SQLite; no auth layer needed (single local user) |
| 7 | Diarization | ✅ **Local voice-embeddings** | resemblyzer (optional `[speaker]` extra) + pure-numpy fallback; built in Phase 3 |
| 8 | Gemini Live model | ✅ **Native-audio (Option B)** | default `gemini-2.5-flash-native-audio-preview-12-2025`; AUDIO out + transcription; voice-out wired. Override via `GEMINI_LIVE_MODEL`; verify your key serves it (`client.models.list()`). |

**All decisions locked.** (Confirm the Gemini Live id is served by your key before the first live run; everything else is settled.)

---

## 2. Why focused-apps-on-a-shared-core (the core decision)

✅ **Confirmed (§1.2 #1).**

- The remaining realtime work (`Live_Assistant`'s Meeting/Code modes + `codeassistant`) is really **two problem domains** wearing the same plumbing, plus one **batch domain** (Jobs). One mega-app forces every user into one bloated UI; focused apps each get a purpose-built UX.
- But the plumbing genuinely *is* shared. Re-implementing AudioWorklet capture, the Gemini Live bridge, the Claude client, transcript management, and the overlay window kit per app is how the prototypes accumulated drift (three different `ScriptProcessor` mic pipelines, three different `ports.json` conventions, two resume-profile sources).
- So: **one monorepo, shared core packages, thin focused apps.** Each app is mostly UI + domain logic + system prompts; the hard media/AI work lives in the core and is tested once.

```
Assistants/                      ← this repo (monorepo)
├── packages/
│   ├── core-web/                ← TS/React: AudioWorklet capture, video/screen capture, realtime WS client,
│   │                              capture+crop pipeline, in-page overlay/window UI kit, markdown renderer, shared hooks
│   └── core-py/                 ← Python: Gemini Live bridge, Claude client, provider router,
│                                  session manager, transcription, diarization/voice profiles, doc parsing,
│                                  structured-output + prompt-cache helpers, local persistence (SQLite)
├── apps/
│   ├── coding/                  ← Coding Copilot
│   ├── meeting/                 ← Meeting Copilot  (local-only)
│   └── jobs/                    ← Job Application Assistant (standalone; reuses core-py Claude client, doc parsing, UI kit)
├── analysis/                    ← per-prototype inventories (reference)
└── REBUILD_PLAN.md              ← this file
```
*(No `desktop-shell` package — decision #4. Each app = React frontend + local FastAPI backend.)*

---

## 3. Master functionality catalog (everything to recreate)

The consolidated "do not lose any of this" list, grouped by capability area. **Owner** = where it lives: **Core** (shared), or which app(s). Source prototypes in parentheses. (Interview-only, scraping, and OS-shell capabilities have been removed.)

### 3.1 Media capture & I/O

| Capability | Owner | Notes / source |
|---|---|---|
| Microphone capture → PCM16 16 kHz mono | **Core** | All realtime prototypes. ⚠️ Replace `ScriptProcessorNode` → **AudioWorklet**. |
| System / tab / loopback audio capture | **Core** | `getDisplayMedia` audio (Live). Drop the throwaway video track. |
| **Mix mic + system audio into one PCM stream** | **Core** | Live (`useAudioCapture` gain-node mix). Great for remote meetings. |
| Webcam capture | **Core** | codeassistant, Live |
| Screen / window / tab capture (`getDisplayMedia`) | **Core** | codeassistant, Live; label by `displaySurface` |
| External **capture-card** input (e.g. Elgato HD60 X) | **Core** | Live (`startDevice(deviceId)`) — for a second physical machine |
| Video frame → JPEG base64 (downscale + quality knobs) | **Core** | codeassistant (1280×720 @ 0.7 @ 2 fps live; full-res @ 0.92 for analysis) |
| Composited capture (rotation + annotation baked into frame) | Coding | codeassistant `getCompositedCanvas` |
| Region crop → image (drag rectangle) | Coding, Meeting | codeassistant region select; Live `CropModal` |
| Audio/video **recording** to file (`.webm`) | **Core** → Meeting | Live `useMediaRecorder` |
| Device enumeration + auto-select by label | **Core** | Live |
| AI speech / TTS output playback *(optional)* | **Core** | ⚠️ Dead-ended in every prototype (configured, never played). Build a real 24 kHz PCM playback path only if/when voice-out is wanted; low priority. |

### 3.2 Realtime AI (streaming)

| Capability | Owner | Notes / source |
|---|---|---|
| Bidirectional realtime session (audio+video+text in, text/audio out) | **Core** | Gemini Live via `client.aio.live.connect`. Backend owns the session; browser never holds the key. |
| Normalized WS envelope `{type, data}` (audio/image/text/multimodal/config) | **Core** | All prototypes; unify the dialects into one protocol. |
| Streamed token-by-token responses + `turn_complete` | **Core** | All; append deltas, mark complete on turn end. |
| Live input transcription (incremental) | **Core** | Live. ⚠️ `is_final` was always false — add interim/final consolidation. |
| Per-mode system-prompt composition from UI toggles | each app | Live `getSystemPrompt`, codeassistant `buildSystemInstruction` |
| Thinking/effort level control | **Core** | Live `thinking_budget`; map to current model params (see §5) |

### 3.3 Deep / batch reasoning

| Capability | Owner | Notes / source |
|---|---|---|
| One-shot "deep analysis" over a captured frame/context | **Core** | codeassistant `/api/analyze`, Live `/analysis/analyze` |
| **Provider-agnostic routing** (Claude vs Gemini by need) | **Core** | Live routes by model-ID prefix; formalize into a small internal capability interface |
| Structured JSON output | **Core** | ⚠️ All prototypes hand-roll fence-stripping/brace-slicing. Replace with **structured outputs** (Claude `output_config.format` / Gemini schema). |
| Streaming generation for long outputs | **Core** | Live |
| Model-comparison (same prompt, two models) | Core (optional) | codeassistant `/api/analyze/compare` (was unused) |

### 3.4 Transcription, diarization, speakers

| Capability | Owner | Notes / source |
|---|---|---|
| Multi-speaker diarization / speaker separation | Meeting | interview used **2 parallel Live sessions** for 2 fixed sources (reference pattern); meetings need true diarization. Per #5 → **local** approach (embeddings/pyannote), not a 3rd-party STT provider. |
| Browser live transcription (Web Speech) + persistent history | Meeting | Live `useSpeechTranscription` + transcript files |
| Speaker identification via voice embeddings + enrollment | **Core** → Meeting | Live `resemblyzer`/torch + cosine match; ⚠️ WebM/Opus decode was unreliable — see §8 |
| Voice profile enrollment (guided prompts) | **Core** | Live `VoiceProfileModal` |
| "Filter my voice" (AI ignores the user) | Meeting | Live `filterUserVoice` |
| AI transcript cleaning (round-trips structured entries) | Meeting | Live `/transcripts/clean` |
| Transcript CRUD + rename + edit + export (TXT/MD) | Meeting | Live `transcript_manager`, `TranscriptManagerModal` |

### 3.5 Domain intelligence — Coding

| Capability | Owner | Source |
|---|---|---|
| Dual-mode: live commentary vs deep one-shot analysis | Coding | codeassistant |
| OCR (extract text from frame, code-fenced) | Coding | codeassistant |
| Region select → auto-analyze | Coding | codeassistant |
| Scroll capture → reconstruct doc → save as context | Coding | codeassistant (⚠️ only sent 1 frame — send multiple) |
| Freehand annotations baked into captures | Coding | codeassistant |
| Prompt templates (Review/Explain/Fix/Optimize/Tests/Refactor/Security/Docs) | Coding | codeassistant |
| Video rotation; source switching (cam↔screen) | Coding | codeassistant |
| Pinned project context | Coding (+ Core) | codeassistant |

### 3.6 Domain intelligence — Meeting (local-only)

| Capability | Owner | Source |
|---|---|---|
| Live transcription + AI note-taking + running summary | Meeting | Live meeting mode |
| Action-item extraction (`**Action:** … *Owner: …*`) | Meeting | Live |
| Meeting topic, elapsed timer, behavior/assist toggles | Meeting | Live |
| Export notes (markdown) | Meeting | Live |
| Select-text → "Ask AI" | Meeting | Live |
| Local persistence of meetings/transcripts (SQLite) | **Core** → Meeting | replaces per-file JSON |
| ~~Cloud deploy (Firebase Hosting + Cloud Run + Terraform); Firebase auth + email allowlist~~ | — | **deferred — local-only (§1.2 #6)** |

### 3.7 Domain intelligence — Job Application (standalone, no scraping)

| Capability | Owner | Source |
|---|---|---|
| **Manual job intake** (paste a job URL or JD text → AI parses to structured metadata) | Jobs | new; replaces scraping as the intake path. Reuses jobapp `job_parser` extraction. |
| Application tracker: status lifecycle, multi-key dedup, smart merge, advanced filter, stats | Jobs | jobapp `history_manager` |
| **Deterministic data-bank resume engine** (per-context DE/DS/MLOps/SWE variants, JD-keyword scoring) | Jobs | jobapp `resume_assembler` — **deferred** (Phase 4.5); LLM engine shipped first |
| LLM resume engine + generate→ATS-score→retry loop + domain-integrity guardrails | Jobs | jobapp `resume_generator` |
| Cross-job "unified resume" synthesis | Jobs | jobapp |
| Application Q&A, cover letter, bank editor w/ AI assists | Jobs | jobapp `gemini_client` |
| Resume/JD doc parsing (PDF/DOCX/TXT) + JD→PDF generation | **Core** (parsing) → Jobs | jobapp; interview `doc_parser` |
| ~~Stealth multi-board scraping; persistent-profile platform auth; Chrome autofill seeding~~ | — | **removed (§1.1)** |

### 3.8 UI / UX

| Capability | Owner | Notes / source |
|---|---|---|
| Glassmorphism dark theme + design tokens | **Core (UI kit)** | all |
| Draggable / resizable / minimizable floating glass windows ("overlay mode") | **Core (UI kit)** | codeassistant `useDraggable`, Live `DraggableWindow` — **in-page** (floats over the captured feed *inside the browser*, not over real OS windows; that's all a browser app can do). |
| Markdown renderer with code copy/collapse, syntax highlight, image lightbox | **Core (UI kit)** | Live `MarkdownRenderer` |
| Crop modal | **Core (UI kit)** | Live `CropModal` |
| Mic level meter, status indicators, connection state | **Core (UI kit)** | all |
| Concurrency/operation manager (bounded parallel, cancel, conflict groups) | **Core** → Jobs | jobapp `processPool`/`activeOps` |
| ~~True OS overlay · global hotkeys · system tray · cursor & display control~~ | — | **out of scope v1 (§1.2 #4)** — these need a Tauri/Electron shell. Revisit by adding one later. |

---

## 4. The focused assistants

### 4.1 Coding Copilot
**Purpose:** An AI "looking over your shoulder" at code on screen/camera.
**Pulls from:** `codeassistant` (primary) + `Live_Assistant` code mode.
**Core features:** screen/camera/capture-card feed · dual-mode (live commentary vs deep analysis) · capture toolkit (OCR, region→analyze, scroll-capture, annotations baked into frames) · prompt templates · pinned project context · **in-page** draggable glass overlay over the captured feed.
**Improve:** send multiple scroll frames; add tool/function calling so it can read files/run snippets (the prototype could only talk about what it saw, not act).
⚠️ **Overlay scope (#4):** without a desktop shell, the overlay floats over the in-browser video feed, **not** over your real desktop/IDE. A true always-on-top-over-everything HUD would require revisiting the desktop-shell decision.

### 4.2 Meeting Copilot (local-only)
**Purpose:** Transcribe meetings, take notes, track action items, summarize — and persist it locally.
**Pulls from:** `Live_Assistant` meeting mode (the actual meeting features). *(Meeting_Assistant was mostly a cloud/auth skeleton — deferred, see below.)*
**Core features:** mic + system-audio mixing · live transcription + diarization/speaker-ID · running summary + action items + topic/timer · transcript history (CRUD, AI-clean, export) · select-text→Ask-AI · recording.
**Deployment:** ✅ **local-only (#6)** — runs on your machine (React frontend + local FastAPI + SQLite). **No Firebase auth, no Cloud Run/Terraform, no auth layer** (single local user). The Meeting_Assistant cloud skeleton stays reference-only.
⚠️ **Privacy:** meeting recording/transcription consent laws vary by jurisdiction — surface a consent affordance.

### 4.3 Job Application Assistant
**Purpose:** AI resume tailoring + application tracking. **No scraping** — you add jobs manually (paste a URL or the JD text).
**Pulls from:** `jobapplicationassistant` (everything except the browser-automation/scraping layer).
**Core features:** manual job intake → AI JD parse → tracker (dedup/merge/filter/stats) · deterministic data-bank resume engine + LLM engine w/ ATS retry loop · cross-job unified resume · application Q&A + cover letters · bank editor.
**Shares from core:** Claude client, doc parsing, structured outputs, UI kit, operation manager. Otherwise its own (non-realtime) app.
**Removed:** Playwright scraping, stealth/anti-bot, CAPTCHA handling, platform login persistence, "view listing authenticated", Chrome autofill-DB seeding (§1.1).

✅ **Build order (#2):** Core first → **Coding Copilot** (most self-contained), then **Meeting Copilot**, with **Jobs** in parallel since it shares little of the realtime stack.

---

## 5. AI model strategy (modern models)

The prototypes used a **mix of real and aspirational/stale Gemini IDs** (e.g. `gemini-3.1-pro-preview`, `gemini-3-flash`, `gemini-2.0-flash-exp`) and dated Claude IDs (`claude-*-20250514`). Reset to a deliberate, current strategy. ✅ **Provider posture (#5): Gemini Live + Claude only** — no third-party STT/realtime providers.

**Key architectural fact:** **Claude has no native realtime bidirectional audio/video streaming API.** Realtime stays on a Gemini-Live-class model; Claude does the heavy reasoning. This split is already the right instinct in the prototypes (Live_Assistant pairs Gemini Live + Claude) — formalize it.

| Job | Model | Why |
|---|---|---|
| **Realtime** audio/video streaming + live commentary + live transcription | **Gemini Live native-audio** — `gemini-2.5-flash-native-audio-preview-12-2025` (#8) | Bidirectional realtime audio+video; replies as audio + transcription (voice-out wired). Override via `GEMINI_LIVE_MODEL`. |
| **Deep reasoning**: code analysis, meeting summaries, resume tailoring, cross-job synthesis | **Claude Opus 4.8** — `claude-opus-4-8` | Most capable; 1M context; adaptive thinking; structured outputs; strong code review & long-horizon work. |
| **Balanced / high-volume** reasoning | **Claude Sonnet 4.6** — `claude-sonnet-4-6` | Best speed/intelligence balance; 1M context; ~⅗ the cost of Opus. |
| **Fast utility**: keyword extraction, ATS scoring, classification, transcript cleaning | **Claude Haiku 4.5** — `claude-haiku-4-5` | Fastest/cheapest; 200K context. |
| **Diarization / speaker-ID** | **Local voice-embeddings** (resemblyzer optional + numpy fallback) | Per #5, no third-party STT provider; runs in the local backend (#7, built). |
| **TTS** *(optional)* | Gemini TTS | Only if you add voice-out; not required by the three apps. |

**Claude pricing (per 1M tokens, for budgeting):** Opus 4.8 $5 in / $25 out · Sonnet 4.6 $3 / $15 · Haiku 4.5 $1 / $5. *(Claude IDs/prices verified against the current model catalog; confirm the Gemini Live ID separately — #8.)*

**Claude API techniques to adopt (big wins over the prototypes):**
- **Streaming** for all live/long outputs (use SDK `.stream()` + `get_final_message()`).
- **Adaptive thinking** (`thinking: {type: "adaptive"}`) + **effort** (`output_config: {effort: …}`) instead of fixed budgets — default `high`/`xhigh` for analysis-grade tasks, `low` for utility passes.
- **Structured outputs** (`output_config.format` / strict tool schemas) — *delete the brace-slicing JSON parsing everywhere.*
- **Prompt caching** — cache the stable system prompt + the big reused context (JD/resume, meeting transcript so far, pinned project context, data banks) as a cached prefix; only the volatile turn changes. Major latency/cost win for these chat-over-context apps.
- **Files API / vision** — send resumes/PDFs and screenshots directly (Claude vision for deep code-screenshot analysis; Gemini for the realtime frame stream).
- **Compaction** for long meetings that exceed context.
- Use the official **Anthropic SDK** (Python `anthropic`) — replace the raw-httpx Claude client in Live_Assistant.

> **Note on the provider seam:** even though we're Gemini+Claude only (#5), keep a thin internal `ProviderRouter` so realtime vs reasoning calls are cleanly separated and swappable *internally* — not to support other vendors, just to keep the code clean and the model IDs in one registry.

---

## 6. Technology stack (and what changes from the prototypes)

| Concern | Prototypes | Decision | Rationale |
|---|---|---|---|
| Frontend framework | Mixed: Vue 3, React 18/19 | ✅ **React 19 + TypeScript** (#3) | Most prototypes already React (incl. the most advanced + the cloud one); one framework for the shared UI kit. |
| Audio capture | `ScriptProcessorNode` (deprecated, all) | **AudioWorklet** | Off-main-thread, non-deprecated, lower latency. |
| Backend | FastAPI + Uvicorn (all) | **Keep FastAPI** (runs locally) | Already consistent and good; async, WS, multipart; hides API keys. |
| Realtime SDK | `google-genai` (good) / mixed legacy in jobapp | `google-genai` unified SDK everywhere | jobapp used the older `google-generativeai`; standardize. |
| Claude SDK | raw `httpx` (Live) | **official `anthropic` SDK** | streaming, structured outputs, caching, retries for free. |
| Desktop / overlay | in-browser fake (codeassistant) / Win32-only (Live) | ✅ **No desktop shell (#4)** — **in-page overlay** only | Browser apps; UI-kit `DraggableWindow` over the captured feed. No OS overlay/hotkeys/tray/cursor control in v1. |
| Persistence | none / scattered JSON / single global file | **SQLite (local)** | Replace per-file transcripts + `application_history.json`. No Firestore (#6). |
| Auth | none / Firebase (Meeting) | **None for v1** | All three apps are local single-user (#6); add auth only if a hosted path returns later. |
| Config | `ports.json` + hardcoded URLs (inconsistent) | **One typed config + Vite proxy**; no hardcoded `localhost:80xx` | ⚠️ Every prototype had port/URL drift. |
| Structured data | in-prompt JSON + brace-slicing (all) | structured outputs | reliability. |
| Secrets | `.env`, CORS `*`, committed PII | server-side secrets, **scoped CORS**, no PII/secrets in repo | ⚠️ jobapp committed real PII. |
| Testing | essentially none | unit tests for core (capture, parsing, provider router), smoke tests per app | the prototypes had ~no tests. |

---

## 7. Shared core — package breakdown

### `packages/core-web` (TypeScript / React)
- **media/** — `AudioWorkletCapture` (PCM16 16 kHz, mic + system-audio mix, level meter), `VideoCapture` (cam/screen/capture-card, device enum), `FrameEncoder` (downscale/quality, composited canvas with rotation+annotation), `MediaRecorder` wrapper, *(optional)* `AudioPlayback` for voice-out.
- **realtime/** — `RealtimeClient` (one normalized WS protocol `{type,data}`; reconnect that respects intentional stop), streaming-delta accumulator, turn-complete handling.
- **ui/** — glass design tokens, `DraggableWindow` (in-page drag/resize/min/max overlay), `MarkdownRenderer` (copy/collapse/highlight/lightbox), `CropModal`, `LevelMeter`, status/connection indicators.
- **state/** — shared hooks (`useRealtime`, `useCapture`, `useTranscript`), per-mode system-prompt composer.

### `packages/core-py` (Python)
- **providers/** — `GeminiLiveBridge` (session per connection, send audio/image/text/multimodal, receive loop with callbacks), `ClaudeClient` (official SDK; streaming, structured outputs, caching, vision, files), **`ProviderRouter`** (internal capability seam + single model registry).
- **realtime/** — session manager, transcript queue + sender task (decouple model receive from socket), interim/final consolidation.
- **transcription/** — local diarization/speaker-ID (embeddings + graceful fallback), voice-profile store, transcript cleaning (structured round-trip).
- **docs/** — PDF/DOCX/TXT/MD parsing (real, not `File.text()`), JD→PDF generation.
- **persistence/** — **SQLite** models (sessions, transcripts, voice profiles, context banks, application history). Local-only; no cloud adapter.
- **util/** — structured-output schema helpers, prompt-cache assembly, defensive provider error handling/retries.

*(No `packages/desktop-shell` — decision #4. The in-page overlay lives in `core-web/ui`.)*

---

## 8. Improvements over the prototypes (fix the debt)

Consolidated punch-list of issues found across the prototypes — bake the fixes into the rebuild:

- [ ] **AudioWorklet** replaces deprecated `ScriptProcessorNode` (all).
- [ ] **Structured outputs** replace fence-stripping/brace-slicing JSON parsing (all).
- [ ] **Real document parsing** in the realtime apps — Live used `File.text()` so binary PDFs/DOCX uploaded as garbage; use core-py parsing.
- [ ] **Fix scroll-capture** — codeassistant collected N frames but sent only the middle one; send multiple image parts.
- [ ] **Single source of config** — kill the `ports.json` vs hardcoded-`localhost` drift; one typed config + Vite proxy.
- [ ] **Persistence** — real local store (SQLite) for transcripts, sessions, banks; transcripts/sessions currently vanish on reload.
- [ ] **Deduplicate model lists** — one central, current model registry (prototypes had stale `/api/models` disagreeing with hardcoded arrays).
- [ ] **Speaker-ID decode** — Live sent WebM/Opus to `soundfile`/`librosa` which can't reliably decode it; standardize on WAV. Add in-memory profile caching.
- [ ] **Transcript finalization** — `is_final` was always false; consolidate interim→final segments; wire identified speaker into transcript entries.
- [ ] **Security** — scope CORS (not `*`), server-side secrets, no PII/secrets committed (jobapp).
- [ ] **Resolve duplicate sources of truth** — jobapp had two profile files (`user_profile.json` vs `context/profile.json`) and two resume engines; Live had model-ID chaos. One canonical each.
- [ ] **Componentize** — jobapp `App.jsx` was 6,247 lines / one component; Live `App.jsx` ~2,334 lines. The shared core + per-app componentization prevents this.
- [ ] **Tool/function calling** — give Coding Copilot the ability to *act* (read files, run snippets, search), not just talk about what it sees.
- [ ] **AI voice-out** *(optional)* — every prototype configured audio responses and never played them; build the playback path only if you want voice-out.
- [ ] **Tests** — none existed for the realtime apps. Cover the core.

> Dropped from the v2 list (no longer applicable): cross-platform Win32 hotkeys/tray/`DisplaySwitch.exe` (no desktop shell, #4) and the Meeting `dev-token` auth bypass (no auth, #6).

---

## 9. Phased roadmap

> Checkboxes are for you to track. Phases are sequential for the shared core; apps can overlap once Core (Phase 1) lands.

> **Progress (2026-06-07):** Phases 0–5 done — **all three apps stand up; hardened** (ruff clean, 27 tests, typechecks, `scripts/test.sh`).
> • **Phase 0/1 (core):** npm-workspaces monorepo (Node 24 / Python 3.13); `core-py` (config, model registry, Claude + Gemini-Live clients, `RealtimeSession`, **speaker-ID embeddings**, doc parsing, SQLite) **20 tests green**; `core-web` (AudioWorklet capture, video capture, RealtimeClient, **SpeechTranscription**, DraggableWindow, MarkdownRenderer) **typechecks clean**.
> • **Phase 2 (Coding Copilot):** backend `/ws/live` (Gemini Live) + `/api/analyze` (Claude vision) + `/api/ocr`; React/Vite frontend (feed, live + analyze, OCR, region-select, annotations, templates, pinned context, overlay) **builds clean**.
> • **Phase 3 (Meeting Copilot, local-only):** backend local speaker-ID (#7) + summary/action-items/clean/ask (Claude) + meeting SQLite CRUD; React/Vite frontend (Web-Speech transcription, speaker-ID loop, voice enrollment, notes, save/load/export, topic/timer) **builds clean**.
> • **#8 resolved (Option B, native-audio):** realtime defaults to `gemini-2.5-flash-native-audio-preview-12-2025`; the Live bridge requests AUDIO + transcription, and **voice-out is wired** (core-web `AudioPlayback`, Coding 🔊 toggle). All 8 decisions locked.
> • **Phase 4 (Job Application Assistant):** backend (JD parse, tracker SQLite w/ dedup+status-history, profile paste/upload, LLM tailor→ATS→retry, cover letter, Q&A, unified resume); React/Vite frontend (Profile / Add Job / Tracker + AI actions) **builds clean**. Data-bank engine deferred (Phase 4.5).
> • Not yet runtime-tested live (needs API keys; confirm the Gemini id is served by your key). Tooling: npm workspaces (no pnpm; global npm cache broken → `--cache ./.npmcache`); Python 3.13 venv (no uv); speaker-ID quality backend `pip install -e "packages/core-py[speaker]"` (else numpy fallback).

### Phase 0 — Foundations
- [x] Scaffold **npm-workspaces** monorepo + `core-web` (React/TS) + `core-py` skeletons. *(npm workspaces, not pnpm/turbo.)*
- [x] Central typed config + secrets handling; single model registry; provider clients (Gemini Live + official Claude SDK) with smoke tests.
- [x] #7 diarization → **local voice-embeddings** (built). · [ ] **#8 Gemini Live model ID** still to confirm (verify in Google AI docs / set `GEMINI_LIVE_MODEL`).

### Phase 1 — Shared core (realtime spine)
- [x] `AudioWorkletCapture` (mic + system mix).
- [x] `VideoCapture` + `FrameEncoder` (+ composite/crop in the Coding app's `lib/capture`).
- [x] `RealtimeClient` + `GeminiLiveBridge` + `RealtimeSession` — **end-to-end** wiring done (Coding `/ws/live`).
- [x] `ClaudeClient` with streaming + structured outputs + prompt caching; `ProviderRouter`.
- [x] UI kit + persistence — `DraggableWindow` + `MarkdownRenderer` + SQLite **done**. *(standalone `CropModal` + a shared glass-token system still to do; region-select + annotations are implemented in the Coding app.)*

### Phase 2 — Coding Copilot
- [x] Feed (camera/screen/device) · dual-mode (live Gemini commentary + Claude deep-analysis) · OCR · region-select · freehand annotations · prompt templates · pinned context · in-page overlay. *(scroll-capture deferred; live path needs API keys + #8 to exercise.)*

### Phase 3 — Meeting Copilot (local-only)
- [x] Transcription (Web Speech) + local diarization/speaker-ID (embeddings) + voice profiles (enroll/list/delete) + transcript history (save/load/AI-clean/export).
- [x] Summary / action-items / ask (Claude) + topic/timer + SQLite persistence. *(audio recording-download + explicit consent affordance deferred.)*

### Phase 4 — Job Application Assistant
- [x] Manual job intake (paste JD → AI parse, structured) + tracker (SQLite: dedup by URL, status lifecycle + history, notes, filter, stats).
- [x] **LLM resume engine** (tailor → ATS-score → retry, factual-integrity guardrail) + cross-job unified resume + master profile (paste / PDF·DOCX upload).
- [x] Application Q&A + cover letters. *(URL auto-fetch intentionally omitted — paste JD. **Deferred:** deterministic data-bank engine + bank editor — see §3.8/§4.3 note.)*

### Phase 5 — Hardening
- [x] **Lint** (ruff, `ruff.toml`) clean across core + app backends; `StrEnum` + `contextlib.suppress` cleanups.
- [x] **Tests**: app-backend suites (jobs store + resume retry-loop, meeting persistence + speaker-ID, coding routes) on top of core's 20 — **27 total**; robust `.env` discovery (walk-up from CWD).
- [x] **Scripts**: `scripts/{setup,test,dev,build}.sh` (one-command setup / all-checks / launch an app / build).
- [x] **Security pass + docs**: `SECURITY.md` (local-first threat model, consent, secrets), README dev section; upload returns 400 on bad file type; backends bind `127.0.0.1`.
- [ ] *(Optional)* TS eslint; per-app installers/packaging; CI workflow.

---

## 10. Cross-cutting concerns

- **Privacy & ethics.** The two previously-sensitive areas (covert interview assistance, job scraping) are **removed** (§1.1). The remaining concern is **meeting recording/transcription consent** — laws vary by jurisdiction; add a consent affordance and be clear about what's stored.
- **Security.** Scoped CORS, server-side secrets, no committed PII/keys. Local-only (#6) shrinks the attack surface — no public endpoints, no auth to get wrong.
- **Cost.** Realtime streaming + Opus reasoning can add up; use Haiku/Sonnet for utility passes, prompt caching for reused context, and effort tuning. Add usage logging from day one.
- **Cross-platform.** Browser apps + local FastAPI are inherently cross-platform; primary target macOS (your machine) + Windows. Nothing Win32-only.
- **Persistence.** Local-first **SQLite** for all three apps. No cloud sync in v1.

---

## 11. Open decisions

✅ **All locked (see §1.2):** #1 shape · #2 build order · #3 React 19 + TS · #4 no desktop shell · #5 Gemini Live + Claude only · #6 Meeting local-only · #7 diarization = **local voice-embeddings** · #8 Gemini Live = **native-audio (Option B)**, default `gemini-2.5-flash-native-audio-preview-12-2025`.

**No open decisions.** One build-time verification remains: confirm your Gemini API key serves the chosen native-audio model (`client.models.list()`), or set `GEMINI_LIVE_MODEL` to one it does (e.g. `gemini-3.1-flash-live-preview`).

---

## 12. Appendix — reference inventories

Full per-prototype deep-dives (capabilities, media I/O, AI calls, reusable patterns, limitations) live alongside this plan. **Note:** `interview_assistant.md`, the scraping sections of `jobapplicationassistant.md`, and the cloud/auth skeleton of `Meeting_Assistant.md` are kept for reference only — those parts are **not** being rebuilt (§1.1, §1.2).

- `analysis/codeassistant.md` — → Coding Copilot
- `analysis/Live_Assistant.md` — → split across Coding + Meeting
- `analysis/Meeting_Assistant.md` — → Meeting Copilot *(meeting features only; cloud/auth deferred)*
- `analysis/jobapplicationassistant.md` — → Job Application Assistant *(scraping excluded)*
- `analysis/interview_assistant.md` — reference only, **not rebuilt**

Originals (read-only reference, not to be copied): `~/Repos/OldAssistants/`.
