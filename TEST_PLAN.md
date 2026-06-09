# Assistants — Comprehensive Test Plan

> **Status:** v1 · **Date:** 2026-06-08 · **Owner:** Kevin
> **Scope:** All features of the three apps (Coding, Meeting, Jobs) + the shared core (`core-py`, `core-web`), covering **automated** (unit / integration / component / live-smoke / E2E) and **manual** testing.
> Companion to `REBUILD_PLAN.md` (the §3 functionality catalog is the feature source-of-truth). Conventions: `[ ]` = to build · ✅ = exists today · ⚠️ = known gap/risk · **(LIVE)** = needs a real API key · **(BROWSER)** = needs a real browser/hardware.

---

## 1. Goals & principles

1. **Most logic is provable without spending money or touching hardware.** The provider clients are seams; mock them. Reserve real Claude/Gemini calls for a small, gated **live-smoke** tier.
2. **Test the wiring we own, not the model's intelligence.** We assert that the right model/role/kwargs/route/parse/persist happens — not that Claude writes a good résumé. Answer *quality* is manual/exploratory.
3. **Pin the known bugs (§9) with regression tests** so they can't silently come back.
4. **Every test is classified** by tier so CI can run the fast/deterministic ones on every commit and gate the slow/live/manual ones.

---

## 2. Current state (baseline)

| Area | Today | Tooling |
|---|---|---|
| `core-py` | ✅ **20 tests** (config, models, router, docs, persistence, realtime-session, speakers) + 1 `live` Claude smoke | pytest, `asyncio_mode=auto`, `live` marker |
| Coding backend | ✅ 1 test (routes-registered only) | pytest |
| Meeting backend | ✅ 1 test (persistence + speaker-ID, via direct coroutine calls — **no TestClient**) | pytest |
| Jobs backend | ✅ 5 tests (`render_resume`, retry-loop ×2, store dedup/status/filter/profile) | pytest |
| **All 3 frontends + `core-web`** | ⚠️ **0 tests** — only `tsc --noEmit` typecheck | **no runner installed** |
| Key/model live check | ✅ `scripts/check_keys.py` (auth both keys, 1 Claude gen, verify every model id vs `models.list()`) | run manually |
| Runner | `scripts/test.sh` = ruff → pytest core-py → pytest each app backend (separately¹) → `npm run typecheck` | — |

¹ App backends are run as separate pytest invocations because each has same-named modules (`main`/`prompts`/`store`) that would collide on import.

**Confirmed available for backend integration tests:** `fastapi.testclient.TestClient`, `httpx`, `pytest-asyncio` are all installed — TestClient suites can be added immediately with no new deps.

**Confirmed missing:** any JS/TS test runner (`vitest`/`jest`/`@testing-library`/`playwright`/`jsdom`). Frontend automated testing requires standing tooling up first (§6).

---

## 3. Test tiers (the strategy)

| Tier | What | Deps | When it runs |
|---|---|---|---|
| **T1 — Pure unit** | Deterministic logic, no I/O: math, parsing, schema, model registry, WS protocol encode/decode, markdown/résumé render | none | every commit |
| **T2 — Backend integration (mocked)** | FastAPI `TestClient` + **mocked Claude** (canned `reason`/`reason_structured`) + **`FakeBridge`** for Gemini + **in-memory SQLite**. Every endpoint, every 400/404/422, CORS, wiring | none (no keys, no net) | every commit |
| **T3 — Frontend component (jsdom)** | `vitest` + `jsdom` + `@testing-library/react`, **mocked `fetch`** + mocked `core-web` classes: component state, disabled gating, route selection, persistence, `lib/*` helpers | new tooling (§6) | every commit |
| **T4 — Live provider smoke** | Real Claude + Gemini Live calls; model-string + structured-output validation | **(LIVE)** keys | nightly / pre-release / manual |
| **T5 — E2E (browser)** | `playwright` w/ `--use-fake-device-for-media-stream`; full flows against a running backend (mocked providers) | new tooling + running stack | pre-release / nightly |
| **T6 — Manual / exploratory** | Real mic/camera/screen-share/audio playback, Web-Speech & voice-ID accuracy, AI answer quality, consent/privacy, cross-browser | **(BROWSER)(LIVE)** human | per release / on feature change |

**Pyramid target:** most coverage in T1+T2 (cheap, deterministic, no keys); a thin T4 to catch SDK/model drift; T3 for frontend logic; T5/T6 for the irreducibly interactive surface (media, speech, real AI).

---

## 4. Test environments

| Env | Purpose | Keys | Notes |
|---|---|---|---|
| **CI / offline** | T1–T3 | none (use a dummy `ANTHROPIC_API_KEY=test` where a gate needs *a* value) | hermetic; `get_settings.cache_clear()` between key-state changes; DB `:memory:` or `tmp_path` |
| **Live-smoke** | T4 | real Anthropic + Google | `pytest -m live`; gate each test with `skipif` on the relevant key (pattern: `test_live.py`) |
| **Local full-stack** | T5/T6 | real keys | each app: `uvicorn main:app --port 80NN` + `npm run dev` (Vite). Chrome for Web Speech. |

**Ports / origins (for CORS + proxy tests):** Coding `8001`/`5173`, Meeting `8002`/`5174`, Jobs `8003`/`5175`. Backends bind `127.0.0.1`; Vite proxies `/api` + `/ws` to the backend (so the browser is same-origin and CORS is exercised only by direct cross-origin calls).

---

## 5. Known issues to pin with regression tests

These were surfaced while mapping the code. Each should get a test that **documents/guards** the behavior (fix-then-test, or test-the-current-behavior-and-flag).

| # | Severity | Area | Issue | Test that catches it |
|---|---|---|---|---|
| K1 | **High** | `core-py/claude` | Haiku 4.5 returns **400** if sent `effort`/adaptive `thinking`. Correctness depends entirely on `_base_kwargs` gating on `ModelSpec` flags. | T1: build kwargs per role; assert Haiku has **neither** `output_config` nor `thinking`; Opus/Sonnet have both. + T4: a real Haiku call with gated kwargs succeeds. |
| K2 | **High** | `core-py/claude` | `reason_structured` does `json.loads(text)` with no guard — a truncated (`max_tokens`) or refusal response raises `JSONDecodeError`. | T2/T1 (mock): feed malformed/empty text → assert failure mode is surfaced, not swallowed. |
| K3 | Med | `core-py/gemini_live` | `output_transcription` **and** `model_turn.parts[].text` both route to `on_text` → possible double-emit of the same content; no consolidation. **Module has 0 tests.** | T2 (mock session): yield both in one turn; assert `on_text` call count (documents dedup behavior). |
| K4 | Med | Jobs backend | `PUT /api/applications/{id}` accepts **any** `status` string (no `STATUSES` enum validation). | T2: PUT `status:"Bogus"` → assert current behavior (accepts) and decide whether to 422. |
| K5 | Med | Jobs backend | `/api/profile/upload` catches only `ValueError`; a **malformed PDF** raises a pypdf error → **500**, not 400. No size/MIME guard. | T2 + fixture: upload a corrupt `.pdf` → assert the (current) 500, track fixing to 400. |
| K6 | Med | Meeting backend | **No `DELETE /api/meetings/{id}`** despite meeting CRUD being in scope; `PUT` overwrites session `metadata` wholesale with `{summary}`. | T2: assert delete absent (scope decision); assert metadata round-trip after summary PUT. |
| K7 | Med | Meeting | **No consent affordance** for mic/system-audio recording (REBUILD_PLAN §10 privacy item). | T6 manual checklist item (compliance) + T3 once added. |
| K8 | Low | `core-web/RealtimeClient` | `send()` while socket not `OPEN` is **silently dropped** (no queue); unknown `type` and binary frames silently ignored. | T1: send-before-open drops; malformed JSON → `onError`; unknown type → no throw. |
| K9 | Low | Jobs | URL-less applications get a random uuid → **never dedup**. | T1/T2 (store): two URL-less creates → two rows; same-URL → one row. |
| K10 | Low | `core-py/db` | No schema migration mechanism (`CREATE TABLE IF NOT EXISTS` only); no `delete_session` method (cascade only reachable via raw SQL). | T1: connect twice to same file = idempotent; document migration gap. |
| K11 | Info | Meeting | Production speaker-ID runs the **pure-numpy `SpectralEmbedder`** (torch/resemblyzer not installed) — lower accuracy than resemblyzer. | T6: set accuracy expectations against `SpectralEmbedder`; T4-fixtures if `[speaker]` installed. |
| K12 | Info | `core-py/claude` | Prompt cache no-ops below min prefix (**4096 tok** Opus/Haiku, 2048 Sonnet) — short system prompts won't cache. | T4: assert `cache_creation_input_tokens` only on a long-enough system prompt (cost note, not a bug). |

---

## 6. Tooling to add (frontend & fixtures)

**Frontend runner (enables T3):** add to root or per-frontend dev-deps:
`vitest`, `jsdom` (or `happy-dom`), `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`. Add `"test": "vitest run"` to each frontend `package.json` and a shared `vitest.config.ts` (`environment: 'jsdom'`). Wire into `scripts/test.sh`.

**E2E (enables T5):** `@playwright/test`; launch Chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`; optionally a fake audio/video file for deterministic media.

**Two tiny refactors that materially raise core-web coverage:**
- Export `base64FromArrayBuffer` (in `AudioWorkletCapture.ts`) so the chunked-btoa encoder is unit-testable.
- Extract the worklet's PCM-clamp/Int16/RMS conversion into a plain exported function (currently trapped in the `WORKLET_SOURCE` string, so it never runs under jsdom).

**Fixtures to commit** (`tests/fixtures/`):
- `sample.pdf` (pypdf-readable, few lines) — `docs.parse_document` PDF path + Jobs upload.
- `sample.docx` (python-docx-readable) — already generated in-test for core; commit one for Jobs upload.
- `corrupt.pdf` (truncated bytes) — K5.
- `speaker_a.wav`, `speaker_b.wav` (16 kHz mono PCM, two distinct voices, ~3 s) — speaker-ID accuracy (T4/fixture, gated on `[speaker]`).

---

## 7. Automated test plan

> IDs: `<AREA>-<TIER>-NN`. Tier letters: U=unit(T1), I=integration(T2), C=component(T3), L=live(T4), E=e2e(T5).

### 7.1 `core-py` — shared Python core

**models.py / config.py / router.py (T1 — mostly ✅, extend)**
- `CORE-U-01` ✅ registry defaults: all roles present, exact model ids, REALTIME→Gemini default.
- `CORE-U-02` ✅ capability flags: Opus/Sonnet effort+thinking; Haiku neither.
- `CORE-U-03` ✅ `GEMINI_LIVE_MODEL` override flows through. **Extend:** also assert `CLAUDE_DEEP/BALANCED/FAST_MODEL` overrides each role, and that an overridden Haiku keeps `supports_effort=False`.
- `CORE-U-04` ✅ router resolves model ids + caches `claude`; **extend:** `gemini_live()` returns a *fresh* bridge each call carrying the REALTIME model id.
- `CORE-U-05` ✅ clients raise without keys. **Add:** `_find_dotenv` walk-up + `get_settings` lru_cache/`cache_clear`.

**claude.py (T1 + T2 mock — ⚠️ currently only no-key + 1 live)**
- `CORE-U-06` **(K1)** `_base_kwargs` per role: effort/thinking present iff supported; system wrapped with `cache_control:ephemeral` iff `cache_system and system`; empty system stays a bare string.
- `CORE-I-07` `reason` (fake client): asserts `messages.create` kwargs (model, max_tokens, system shape) and `_text_of` concatenates multi-block text.
- `CORE-I-08` `reason_structured`: merged `output_config` = `{effort?, format:{json_schema}}`, `thinking` absent; valid JSON across blocks parses; **(K2)** malformed/empty → raises (documented).
- `CORE-I-09` `stream_reason`: fake `text_stream` async-iterates → yields deltas in order.

**gemini_live.py (T2 mock — ⚠️ 0 tests; highest-risk surface)**
- `CORE-I-10` `connect`: no key → `RuntimeError`; with fake genai, builds `LiveConnectConfig` with `response_modalities` + input/output transcription configs for AUDIO; spawns receive loop.
- `CORE-I-11` `_receive_loop` routing: fake `receive()` yields input_transcription→`on_transcript`, output_transcription→`on_text`, model_turn text→`on_text`, inline_data→`on_audio`, turn_complete→`on_turn_complete`; empty `.text` skipped. **(K3)** both transcription+model_turn in one turn → assert `on_text` count.
- `CORE-I-12` `_emit` handles sync vs coroutine callbacks; `on_error=None` → exception doesn't crash loop; non-None → receives the exception.
- `CORE-I-13` `send_audio/image/text` build correct `Blob`/`Content` + mime types; `close()` cancels the recv task and exits the CM.

**realtime/session.py (T2 — ✅ extend)**
- `CORE-I-14` ✅ config connects + routes audio/text; autoconnect uses base_system; callbacks → protocol envelopes (b64 audio). **Extend:** exercise `image` and `multimodal` (image-then-text) message types.

**transcription/speakers.py (T1 — ✅ extend; T4-fixture)**
- `CORE-U-15` ✅ `pcm16_to_float32` scaling + empty; `cosine` basics; enroll/identify/Unknown via `StubEmbedder`; profile list hides embedding; delete.
- `CORE-U-16` **add:** `SpectralEmbedder.embed` determinism + L2-norm (pure numpy, currently untested); `_mean_embedding([])` → `ValueError`; `identify` threshold boundary (`score==threshold` → name; empty profiles → `("Unknown",0.0)`).
- `CORE-L-17` **(LIVE/fixture, K11)** with `[speaker]` installed: enroll `speaker_a`+`speaker_b` from WAV fixtures; identify each correctly; cross-speaker < 0.75.

**docs/parsing.py (T1 — ✅ extend; fixture)**
- `CORE-U-18` ✅ txt/md decode; unsupported→`ValueError`; docx round-trip. **Add:** uppercase ext (`.PDF`), extension-less filename→`ValueError`, UTF-8 `errors="replace"` on invalid bytes.
- `CORE-U-19` **fixture:** `_parse_pdf(sample.pdf)` extracts expected text.

**persistence/db.py (T1 — ✅ extend)**
- `CORE-U-20` ✅ session/transcript/entry round-trip + ordering + speaker; metadata JSON round-trip. **Add:** `update_session` (title-only, metadata-only, no-op branch), `add_entry` bumps `updated_at` + returns `lastrowid`, `get_session`→None, FK cascade on delete (raw SQL), file-path `connect()` creates parent dir (`tmp_path`), idempotent reconnect (**K10**).

**util/structured.py (T1 — ⚠️ 0 tests)**
- `CORE-U-21` `object_schema`: default `required==all keys` + `additionalProperties:false`; explicit `required` honored; `additional=True` flips it.

### 7.2 `core-web` — shared TS/React core (T1/T3 — ⚠️ 0 tests, needs §6 tooling)

- `WEB-U-01` `protocol.ts` — compile-time type guards (`@ts-expect-error` fixtures) lock the envelope; no runtime.
- `WEB-U-02` **`RealtimeClient`** (stub `globalThis.WebSocket` + fake timers): each `ServerMessage` routes to the right handler; malformed JSON→`onError`; **(K8)** send-before-OPEN drops; unknown `type`/binary frame ignored; reconnect backoff = 1/2/4/8/15 s cap; `retries` resets on open; `maxRetries` cutoff; `close()` suppresses reconnect.
- `WEB-U-03` `FrameEncoder.encodeFrameToJpegBase64` scaling math (`scale=min(1,maxW/sw,maxH/sh)`, round, ≥1px floor), null on zero-dims, `data:` prefix strip (mock canvas).
- `WEB-U-04` `MarkdownRenderer.extractText` ReactNode→string flatten (pure).
- `WEB-U-05` `AudioPlayback.enqueue` decode (b64→Int16→Float32 `/32768`) + gapless scheduling (`nextTime=max(nextTime,currentTime)+duration`); `<2`-byte input no-op (mock AudioContext).
- `WEB-U-06` `base64FromArrayBuffer` chunked-btoa correctness (after export refactor); extracted worklet PCM/RMS conversion.
- `WEB-C-07` `useRealtime` (renderHook): `connected` flips on open/close; `text` accumulates deltas and **resets on `turnComplete`**; client created once; unmount→`close()`.
- `WEB-C-08` `MarkdownRenderer` component: inline vs fenced; language + line-count label; copy button (mock `clipboard`); collapse appears only when `lines>8`.
- `WEB-C-09` `DraggableWindow`: pointerdown→move→up updates `left/top` by delta (stub `setPointerCapture`); collapse hides body; `onClose` fires.
- `WEB-C-10` `SpeechTranscription` (inject fake recognizer): `isSupported`; interim-vs-final split; **auto-restart on `onend` while running**; `onError` mapping; `stop()` clears running.
- `WEB-C-11` `VideoCapture` (mock `mediaDevices`): each `start*` sets `kind`+constraints (deviceId `exact` for device, screen vs camera); `attach` stops prior stream; track `"ended"`→`stop()`; `listVideoInputs` filters `videoinput`; `captureFrame` null when inactive.
- `WEB-C-12` `AudioWorkletCapture` (mock Web Audio + mediaDevices): idempotent `start`; 16 kHz context; addModule-from-blob; system-audio path stops forced video track and **throws when no audio track**; `stop()` revokes URL + stops tracks + closes context.

### 7.3 Coding Copilot

**Backend (T2 — ⚠️ only routes-registered today). Mock seam: monkeypatch `main.router.claude.reason` (async stub capturing args); inject `FakeBridge` via `main.router.gemini_live`.**
- `COD-I-01` `/health` shape `{status,app:"coding",anthropic,google}`; `/api/models` maps 4 roles.
- `COD-I-02` `/api/analyze`: missing key→**400**; role coercion (invalid **and** `realtime`→`reason_deep`); `context` appended to system; `user_with_image` used iff image present (assert via captured args); response `{response,model}`; provider error→500.
- `COD-I-03` `/api/ocr`: missing key→400; uses `REASON_FAST` + `thinking=False`; required image→422; `{text}` shape.
- `COD-I-04` `WS /ws/live` (`TestClient.websocket_connect` + `FakeBridge`): `config`→`{status:"connected"}`; audio/image/text/multimodal decode + route to bridge; auto-connect-before-config uses `CODING_LIVE_SYSTEM`; handler error→`{type:"error"}` then close; clean disconnect.
- `COD-I-05` CORS: preflight from `:5173` allowed; from a disallowed origin not reflected.
- `COD-L-06` **(LIVE)** real `/api/analyze` with a small image returns non-empty text on Opus; `/api/ocr` extracts known text on Haiku.

**Frontend (T1/T3/E2E):**
- `COD-U-07` `lib/templates.ts`: 8 templates, unique ids, non-empty prompts.
- `COD-U-08` `lib/api.ts`: `analyze`/`ocr` method/headers/body; non-2xx throws `"{status}: {text}"` (mock fetch).
- `COD-U-09` `lib/capture.ts` `contentRect` object-fit-contain math (pure); `compositeFrame`/`cropFrame` scale/crop arithmetic (extract pure fn or run in browser tier — canvas not in jsdom).
- `COD-C-10` `App` template routing: Live on→`rt.sendText`; Live off→`runAnalyze` (mock core-web); pinned-context `localStorage` round-trip; analyze-role select drives `role`.
- `COD-C-11` `CaptureCanvas`: region drag ≥4×4 → `onRegion(rect)` with correct coords; `clear` wipes.
- `COD-E-12` **(BROWSER)** fake-media: start screen feed → toggle Live → frames POST over WS (stub backend) → streamed text into the Live window.

### 7.4 Meeting Copilot

**Backend (T2 — ⚠️ 1 direct-call test, no TestClient). Pattern: `TestClient(app)`; swap `main._state["db"]=Database(":memory:")`, `main._state["identifier"]=SpeakerIdentifier(db,StubEmbedder())`; monkeypatch `main.router.claude`.**
- `MTG-I-01` Speaker-ID: `/api/enroll-speaker` (synthetic b64 PCM16) → `{name,num_samples}`; `/api/identify-speaker` returns enrolled name for matching clip, `"Unknown"` for far clip; `/api/voice-profiles` lists without leaking embedding; `DELETE /api/voice-profiles/{name}`→`{ok}` then gone.
- `MTG-I-02` Claude notes (mocked): `/api/summarize`→`{summary}` (REASON_BALANCED); `/api/action-items`→`{items:[{action,owner}]}` via structured schema; `/api/clean-transcript`→`{cleaned}` (REASON_FAST, thinking off); `/api/ask`→`{answer}` (REASON_DEEP) with transcript+question composed.
- `MTG-I-03` `_require_anthropic` **400** path on all four note endpoints (clear key + `cache_clear()`).
- `MTG-I-04` Meeting CRUD over HTTP: create→append-entries→get (entry order + speaker); `list_meetings` ordered `updated_at DESC`; `GET /{id}` **404**; **(K6)** `PUT` title + summary→metadata round-trip (assert `GET` returns `metadata.summary`); append against missing id behavior.
- `MTG-I-05` Validation 422 on malformed bodies; `/health`+`/api/models` shapes.
- `MTG-I-06` **(K6)** assert no `DELETE /api/meetings/{id}` route (scope decision flag).
- `MTG-L-07` **(LIVE)** `/api/action-items` against real Claude honors the `json_schema` structured output (parses to `{items:[...]}`).

**Frontend (T1/T3/E2E):**
- `MTG-U-08` `lib/format.ts`: `clockOf`/`elapsed`/`entriesToText` (pin UTC/fixed ts); `download` builds Blob+anchor (mock `URL.createObjectURL`).
- `MTG-U-09` `lib/api.ts` request shaping incl. `encodeURIComponent` on profile delete; `lib/recorder.ts` clip length.
- `MTG-C-10` `NotesPanel` buttons disabled unless `entries.length>0 && !busy`; `ControlBar` record disabled when `SpeechTranscription.isSupported()` false; `TranscriptView` interim line + auto-scroll.
- `MTG-C-11` Save flow: first save→`POST /api/meetings` then append **only new** entries (`slice(savedCount)`); `onLoad` repopulates topic/summary/entries; export downloads `meeting-*.md` (mock fetch + core-web).
- `MTG-E-12` **(BROWSER, Chrome)** fake-media: record toggles live, speaker pill updates from `/api/identify-speaker`, enroll modal → save → list/delete, Save→History→Load round-trip.

### 7.5 Job Application Assistant

**Backend (T1/T2 — ✅ 5 unit tests; ⚠️ 0 HTTP). Mock seam: monkeypatch `main.router.claude` for canned parsed-JD/résumé/ATS/cover/answer.**
- `JOB-U-01` ✅ `render_resume` markdown. **Extend:** projects section, missing keys, empty arrays, special chars.
- `JOB-U-02` ✅ retry loop stops on threshold (`iters==2`) + respects max-iters. **Extend:** first-score≥threshold → exactly 2 Claude calls; `max_iterations=1` never retries; **fake that records prompts** → 2nd generation prompt contains `missing[:15]` keywords + "do not fabricate" (the guardrail-feedback path).
- `JOB-U-03` ✅ store dedup-by-URL + status-history + filter + profile. **Extend (K9):** two URL-less creates → 2 rows; notes-only update leaves `status_history` untouched; `update_application` on missing id→None; status-history appends **only on change**; `stats()` grouping.
- `JOB-I-04` Tracker CRUD over HTTP: create/list/get/put/delete incl. `GET`/`PUT` missing→**404**, `DELETE` idempotent (no 404), `?status=`/`?query=` filter, `/api/stats`, `/api/statuses` (7), `/api/models`, `/health`.
- `JOB-I-05` **(K4)** `PUT status:"Bogus"` → assert current (accepts) behavior; track decision to validate against `STATUSES`.
- `JOB-I-06` `/api/parse-jd`: 400 no-key; happy path returns `PARSED_JOB_SCHEMA` object (mocked).
- `JOB-I-07` `/api/tailor`: 400 no-key, **400 no JD** (`_resolve_jd`), **400 no profile** (`_profile_or_400`); resolve by `application_id` (create app w/ `jd_text` then tailor); response `{resume,resume_markdown,ats,iterations}`.
- `JOB-I-08` `/api/cover-letter` + `/api/answer-question`: 400 gates + happy path (REASON_BALANCED / REASON_DEEP) with profile+jd(+question) composed.
- `JOB-I-09` `/api/unified-resume`: multi-id combine; **400 when no selected app has a JD**.
- `JOB-I-10` `/api/profile` get/set single-row upsert; **`/api/profile/upload`** (fixtures): pdf/docx/txt/md dispatch, `{ok,chars}`, **400 unsupported ext**, **(K5)** corrupt `.pdf` → current 500 (track→400).
- `JOB-L-11` **(LIVE)** real `tailor_and_score` end-to-end: ATS score is an int 0–100, loop terminates, integrity (spot-check no fabricated employer) — exploratory.

**Frontend (T1/T3/E2E):**
- `JOB-U-12` `lib/api.ts` wrapper (mock fetch) + `lib/types.ts` shape sanity; client-side `downloadText` Blob.
- `JOB-C-13` `ApplicationDetail` ATS score color class thresholds (≥80 good / ≥60 warn / else bad); busy-button disabling; status-change→`PUT`; notes-on-blur→`PUT`; delete behind `confirm()`.
- `JOB-C-14` `AddJob` parse→populates empty title/company; Track→clears form + `onTracked`; `Tracker` filter change → refetch list+stats.
- `JOB-E-15` **(BROWSER)** happy path against running backend (mocked Claude): paste JD→parse→track→tailor→see score→download .md.

---

## 8. Manual / exploratory test plan (T6)

For the irreducibly interactive surface. **Preconditions for all:** real `.env` keys set; `scripts/check_keys.py` green; backend running on its port; `npm run dev`; **Chrome** (Web Speech is Chrome-only); grant mic/camera/screen permissions when prompted.

### 8.1 Pre-flight (run once)
- [ ] `MAN-PRE-01` `python scripts/check_keys.py` → ALL CHECKS PASSED (both keys auth; Claude gen; Gemini model served + Live-capable).
- [ ] `MAN-PRE-02` `bash scripts/test.sh` → ruff + all pytest suites + typecheck green.
- [ ] `MAN-PRE-03` Each `/health` returns `anthropic:true, google:true`.

### 8.2 Coding Copilot
| ID | Feature | Steps | Expected |
|---|---|---|---|
| MAN-COD-01 | Camera feed | ControlBar → 📷 Camera | Live video; permission prompt; feed visible |
| MAN-COD-02 | Screen capture | 🖥️ Screen → pick a window | Selected surface streams; stop on "ended" |
| MAN-COD-03 | Capture-card | plug device → select → Use | External input streams (HD60 X etc.) |
| MAN-COD-04 | **Live commentary** | ⚡ Live with a code editor on screen | Streamed Gemini commentary into the Live window; updates as screen changes |
| MAN-COD-05 | Mic input | 🎙️ during Live; speak | Level meter moves; spoken question influences response |
| MAN-COD-06 | **Voice-out** | 🔊 toggle during Live | Model audio plays back (24 kHz), gapless; 🔇 silences |
| MAN-COD-07 | Deep analysis | type Q in 🔬 + Ctrl+Enter | Full-res frame sent; Claude markdown answer; user thumb shown |
| MAN-COD-08 | OCR | 🔤 over a code screenshot | Code-fenced extracted text matches screen |
| MAN-COD-09 | Region→analyze | ⬚ Region, drag a box | Only the crop is analyzed |
| MAN-COD-10 | Annotations | ✏️ draw, then analyze | Pink strokes baked into the sent frame; Clear wipes |
| MAN-COD-11 | Templates | pick each of 8 | Live on→sent as live text; off→runs analyze |
| MAN-COD-12 | Pinned context | ⚙ set context, reload | Persists (localStorage); included in answers |
| MAN-COD-13 | Overlay | drag/collapse/close each window | Smooth pointer drag; collapse + close work |
| MAN-COD-14 | Reconnect | kill+restart backend mid-Live | Behavior per `reconnect:false` (Coding) — surfaces disconnect |

### 8.3 Meeting Copilot
| ID | Feature | Steps | Expected |
|---|---|---|---|
| MAN-MTG-01 | **Consent (K7)** | start recording | ⚠️ Confirm whether any consent notice shows — currently **none**; flag for compliance |
| MAN-MTG-02 | Live transcription | ● Record, speak | Interim + finalized entries (Web Speech); timer ticks |
| MAN-MTG-03 | System audio | enable Sys, share a tab w/ audio | Remote speaker captured + transcribed |
| MAN-MTG-04 | Voice enrollment | Profiles → record ≥1 clip → name → Save | Profile appears with num_samples |
| MAN-MTG-05 | **Speaker-ID** | enroll 2 people, run meeting | Speaker pill switches; entries tagged (note: `SpectralEmbedder` accuracy, K11) |
| MAN-MTG-06 | Delete profile | Profiles → Delete | Removed from list |
| MAN-MTG-07 | Summary | with entries → Summary | Markdown running summary |
| MAN-MTG-08 | Action items | → Action items | List of `Action / Owner` |
| MAN-MTG-09 | Clean transcript | → Clean | Tidied transcript (Haiku) |
| MAN-MTG-10 | Ask AI / selection | select text → Use selected → ask | Answer grounded in transcript |
| MAN-MTG-11 | Save/Load | Save → reload → History → Load | Topic/entries/summary restored; only new entries appended on re-save |
| MAN-MTG-12 | Export | Export | `meeting-*.md` downloads with topic+entries+summary |
| MAN-MTG-13 | No-key behavior | unset ANTHROPIC key | Note buttons → 400 surfaced as alert; transcription still works |

### 8.4 Job Application Assistant
| ID | Feature | Steps | Expected |
|---|---|---|---|
| MAN-JOB-01 | Profile paste | Profile → paste → Save | "Saved ✓"; char counter |
| MAN-JOB-02 | Profile upload | upload real PDF + DOCX résumé | "Loaded N characters"; text populates |
| MAN-JOB-03 | Upload bad file | upload `.png` / corrupt `.pdf` | `.png`→400 alert; corrupt pdf→**500 today (K5)** |
| MAN-JOB-04 | Parse JD | Add Job → paste JD → Parse | Title/company auto-fill; skill chips, seniority |
| MAN-JOB-05 | Track | Track | Appears in Tracker; form clears |
| MAN-JOB-06 | Dedup | track same URL twice | One row (merge); URL-less → separate rows (K9) |
| MAN-JOB-07 | Status lifecycle | change status across the 7 | History count increments only on change |
| MAN-JOB-08 | Notes | edit notes → blur | Persisted (no history bump) |
| MAN-JOB-09 | Filter + stats | filter by status; check chips | List + stats reflect filter |
| MAN-JOB-10 | **Tailor résumé** | open app → Tailor | ATS score (colored), iteration count, "still missing" chips, markdown résumé, Download .md |
| MAN-JOB-11 | Integrity | inspect tailored résumé | No invented employers/titles/dates/skills (guardrail is prompt-only — verify) |
| MAN-JOB-12 | Cover letter | Cover letter | Grounded markdown letter |
| MAN-JOB-13 | Q&A | ask an application question | Grounded answer |
| MAN-JOB-14 | Unified résumé | select ≥2 apps w/ JDs → unify | One résumé optimized across all; 400 if none have JDs |

### 8.5 Cross-cutting manual
- [ ] `MAN-X-01` **Security:** confirm backends bind `127.0.0.1` (not reachable from LAN); `.env` never committed (`git status` clean); no PII in repo.
- [ ] `MAN-X-02` **CORS:** a fetch from a random origin to `:800N` is blocked.
- [ ] `MAN-X-03` **Cost/usage:** watch token usage during a Live session + a Tailor run; confirm Haiku used for OCR/clean, Opus for analysis/ask/tailor.
- [ ] `MAN-X-04` **Cross-browser:** apps load in Safari/Firefox; Meeting record button correctly **disabled** there (Web Speech unsupported).
- [ ] `MAN-X-05` **Persistence:** SQLite file at `ASSISTANTS_DB_PATH` survives restart; meetings/applications/profiles reload.
- [ ] `MAN-X-06` **Model drift:** re-run `check_keys.py`; if the `-latest` Gemini alias rotated, confirm Live still connects (decision #8).

---

## 9. Coverage matrix (priority roadmap)

| Priority | Work | Tier | Why |
|---|---|---|---|
| **P0** | `gemini_live.py` mock tests (CORE-I-10..13) | T2 | 0% on the riskiest, SDK-fragile surface (K3) |
| **P0** | `claude.py` `_base_kwargs` + structured/parse (CORE-U-06, I-07..09) | T1/T2 | K1/K2 are correctness-critical, key-free |
| **P0** | Backend TestClient suites: Coding (COD-I-01..05), Meeting (MTG-I-01..06), Jobs (JOB-I-04..10) | T2 | Whole HTTP layer + every 400/404/422 unproven today |
| **P1** | `util/structured.py` (CORE-U-21), docs PDF fixture (CORE-U-19), db extensions (CORE-U-20) | T1 | cheap, closes named gaps |
| **P1** | Jobs unit extensions: retry-feedback-prompt + store edges (JOB-U-02/03) | T1 | guardrail + dedup (K9) regression |
| **P1** | Stand up **vitest+jsdom+RTL** (§6); `core-web` `RealtimeClient`/`AudioPlayback`/`extractText` (WEB-U-02/05/04) | T3 | unblocks all frontend coverage |
| **P2** | Frontend component + `lib/*` tests across 3 apps | T3 | logic/gating/persistence |
| **P2** | Live-smoke suite: Gemini Live connect, Claude structured output, model-string check in CI nightly | T4 | catch model/SDK drift (K12, decision #8) |
| **P3** | Playwright E2E w/ fake media (COD-E-12, MTG-E-12, JOB-E-15) | T5 | full-flow confidence |
| **P3** | Speaker-ID accuracy w/ WAV fixtures + `[speaker]` extra | T4 | K11 quality bar |

**Definition of done (per app):** P0+P1 green in `scripts/test.sh`; manual §8 checklist passed once on real keys; known issues §5 each have a pinning test or a tracked decision.

---

## 10. CI recommendation

```
# on every PR (hermetic, no keys):
ruff check . && \
pytest packages/core-py -q && \
pytest apps/coding/backend -q && pytest apps/meeting/backend -q && pytest apps/jobs/backend -q && \
npm run typecheck && npm run test --workspaces --if-present   # vitest, once added

# nightly (keys in CI secrets):
pytest -m live -q && python scripts/check_keys.py
```
Keep app-backend pytest runs **separate** (same-named modules collide on import — already the `test.sh` pattern). Gate `-m live` and Playwright behind a label/secret so PRs stay fast and free.
