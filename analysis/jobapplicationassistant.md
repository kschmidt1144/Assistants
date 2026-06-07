# JobApplicationAssistant — Functionality Inventory

> Clean-room rebuild reference. Captures WHAT each capability does and HOW it was implemented. No code is copied. Cites key files inline.

## Purpose

An AI-powered, single-user desktop/web job-search cockpit. It scrapes job boards (Indeed, LinkedIn, ZipRecruiter) via stealth Playwright, tracks applications in a local JSON pipeline (Kanban-style statuses + dedup/merge), uses Gemini to extract structured metadata from job descriptions, and generates ATS-optimized resumes (DOCX) two ways: (1) a **deterministic assembler** driven by curated JSON "data banks", and (2) a **legacy full-LLM generator**. It also synthesizes a single "unified resume" optimized across many job listings simultaneously. There is **no realtime audio/video** — media I/O is limited to file upload (PDF/DOCX/TXT/MD parsing) and file/PDF download.

## Tech Stack

- **Frontend:** React 19 (single 6,247-line `App.jsx`, no router, no component library), Vite 7, plain CSS (`App.css`). All UI state is local `useState` in one component, persisted to `sessionStorage` under key `jobAssistantState`. File: `web_app/frontend/src/App.jsx`, `web_app/frontend/vite.config.js`.
- **Backend:** FastAPI + Uvicorn, fully async. Single entrypoint `web_app/backend/server.py` (~1,800 lines, ~60 endpoints + WebSocket). A separate legacy Rich-based CLI exists at `main.py`.
- **AI:** Google Generative AI SDK (`google-generativeai`), model **`gemini-2.0-flash`** for everything. `services/gemini_client.py` instantiates two handles (`self.model` and `self.pro_model`) but **both point at `gemini-2.0-flash`** (the "pro" tier is aspirational; CLAUDE.md describes a separate pro model that isn't actually wired).
- **Browser automation:** Playwright (async) with `playwright-stealth` (`Stealth().apply_stealth_async`). Uses installed Chrome channel where possible, falls back to bundled Chromium; uses **Firefox** for authenticated listing viewing and "open in browser".
- **Docs/parsing:** `python-docx` (DOCX generation), `PyMuPDF`/`fitz` (PDF text extraction + PDF generation of job descriptions), `python-multipart` (uploads).
- **Key libraries:** fastapi, uvicorn[standard], websockets, playwright, playwright-stealth, google-generativeai, pydantic, python-dotenv, python-docx, pymupdf, beautifulsoup4 (listed, lightly used), rich (CLI), aiofiles.
- **Ports:** Read from a shared `../../../ports.json` (`JobApplicationAssistant.backend/frontend`). Vite proxies `/api` and `/ws` to the backend. Note an inconsistency: `App.jsx` hardcodes `API_BASE = 'http://localhost:8000'` and connects WebSocket directly to `ws://localhost:8000/ws` rather than using the Vite proxy.

## Media I/O

There is **no webcam, screen capture, microphone, system audio, or TTS** anywhere in this project. The only media channels are:

| Channel | Direction | Implementation |
|---|---|---|
| Document upload (resume/cover-letter context) | input | Browser `<input type=file>` → `FormData` POST to `/api/generate-resume`, `/api/generate-unified-resume`, `/api/context`. Server extracts text: PDF via `fitz.open(stream=...).get_text()`, DOCX via `docx.Document`, else UTF-8 decode. `extract_text_from_file()` in `server.py`; persistent context files saved to `context/` and read by `services/context_loader.py`. |
| Resume file download (DOCX/PDF) | output | `GET /api/download-resume?filename=` → `FileResponse` with sanitized basename; also static-mounted at `/resumes`. Generated into `generated_resumes/`. `server.py`. |
| Job-description PDF generation | output | `GET /api/history/{job_id}/download-jd` builds a multi-page Letter PDF on the fly with PyMuPDF `insert_textbox` (title/company/location/URL header, divider, paragraph reflow + overflow handling), returned as `StreamingResponse`. `server.py` lines ~976-1108. |
| Authenticated job-listing view | output (headful browser) | `POST /api/view-listing` launches a **headful Firefox** Playwright persistent context using the platform's saved profile dir, navigates to the URL so the user sees it logged-in. `server.py` `view_listing_authenticated`. |
| Bulk "open in Firefox" | output | `POST /api/open-in-firefox` spawns the OS Firefox binary via `subprocess.Popen` for each URL (Windows-path detection in `_find_firefox_path`). `server.py`. |

## Core Features

### 1. Multi-platform job scraping (stealth)
- `POST /api/search` (single) and `POST /api/search/complex` (list of independent searches). Params: `platforms[]`, `query`, `location`, `max_results` (per platform, default 25), `work_type` (any/remote/onsite/hybrid), `country` (any/us).
- Each platform inherits `BasePlatform` (`platforms/base_platform.py`) and implements `search_jobs()` + `fetch_job_description()`.
- **Pagination + human emulation:** Indeed (`start` step 10), LinkedIn (`start` step 25, `f_WT` work-type codes, US `geoId=103644278`), ZipRecruiter (`page` step 1). Each loops up to `max_pages=10`, scrolls, and uses `_human_delay()` random sleeps; Indeed adds `_simulate_human_behavior()` (random mouse move + wheel). Files: `platforms/indeed.py`, `platforms/linkedin.py`, `platforms/ziprecruiter.py`.
- **Per-platform parsers** extract title/company/location/url/salary/posted-date with multiple fallback CSS selectors (guest vs logged-in DOM variants on LinkedIn). Salary parsed to min/max/type and normalized to annual (hourly×2080, monthly×12, weekly×52). Relative dates ("3 days ago", "Just posted") converted to ISO via `_parse_relative_date`. ZipRecruiter additionally detects `quick_apply` (1-Click vs external).
- **Cloudflare/CAPTCHA handling:** Indeed/ZipRecruiter detect "challenge"/"captcha"/"verify" in page content and wait (Indeed loops with more human behavior; ZipRecruiter waits 30s for the user to solve manually in the visible window).
- Results cached server-side in `cached_jobs` and returned to the client; searches recorded to `recent_searches.json` (last 15, dedup).

### 2. Saved & recent searches
- Recent searches auto-saved (`recent_searches.json`, max 15). Named **complex searches** CRUD: `GET/POST /api/complex-searches`, `DELETE /api/complex-searches/{name}` → `saved_complex_searches.json`. `server.py`.

### 3. Job description fetch + parse
- `GET /api/job/{job_index}/description` scrapes the full JD for a cached job (and back-fills salary if found).
- `POST /api/history/{job_id}/parse` and `/parse-batch` run **AI structured extraction** via `services/job_parser.py` → `ParsedJobData` dataclass: required/preferred skills, experience min/max years, education level, salary min/max (normalized), work_type, seniority, job_type, employment_type (w2/1099/c2c), visa_sponsorship, key_responsibilities. Stored on the history entry as `parsed_data`. Robust JSON extraction with markdown-fence stripping and brace-slicing.

### 4. Application tracker (history) — the data hub
- `services/history_manager.py` persists to `application_history.json`. Stable IDs = `md5(job_url)`.
- **Dedup on insert** by (a) exact id/url, (b) platform job-id extracted from URL (`extract_platform_job_id`: Indeed `jk=`, LinkedIn `/view/<id>` or `currentJobId`, ZipRecruiter `jid=` or `/job/<slug>`), (c) fingerprint `title|company` (company suffix-normalized).
- **Status lifecycle:** New, Saved/Interested, Applied, Interviewing, Offer, Rejected, Withdrawn, Not Interested. Each change appends to `status_history` (status/date/note). Bulk status update + bulk delete supported.
- **Duplicate detection & merge:** `GET /api/history/find-duplicates` returns exact (platform-id) + potential (fingerprint) groups; `merge-duplicates` / `auto-merge` consolidate preserving earliest timestamp, latest update, highest-priority status, longest description, richest parsed_data, combined notes/status history.
- **Advanced search/filter:** `GET /api/history/advanced-search` with query, status, platform, skills[], work_type, seniority, employment_type, min/max experience, min/max salary, has_parsed_data, date_tracked (today/7days/30days), quick_apply. Filter dropdown options derived from parsed data (`get_filter_options`). Stats endpoint counts by status/platform.
- Notes editing, JD refetch for a tracked job, JD→PDF download all per-entry.

### 5. Resume generation (two engines)
**Engine A — Deterministic bank assembler (`services/resume_assembler.py` + `generate_from_banks`)**
- Pipeline (in `services/resume_generator.py::generate_from_banks`): (1) LLM extracts JD keywords; (2) `ResumeAssembler.assemble_nested()` deterministically builds the resume; (3) optional LLM summary polish (`tailor_summary`); (4) render DOCX; (5) LLM ATS score.
- **Context detection:** scores DE/DS/MLOps/SWE by counting JD keyword overlaps against per-skill `contexts` in `skills_bank.json`; picks best.
- **Selection logic:** skills matched/ranked (required=3, preferred=2, context-relevant=1; tie-break by proficiency) with per-format caps; experience bullets scored by keyword overlap with a recency-weighted bullet budget; projects scored by tech + bullet overlap. "Nested" layout attaches role-scoped initiatives (projects linked via `role_id`) with Jaccard near-duplicate filtering (`_is_near_duplicate`, threshold 0.6).
- **Format constraints (`FORMAT_LIMITS`):** 1-page (ATS threshold 0.65, flattens initiatives into bullets) vs 2-page (threshold 0.80, renders initiative sub-sections). Distinct bullet/project/skill caps per format.
- **Summary templates** per context with top-5 matched skills injected; optional LLM polish for keyword density.

**Engine B — Legacy full-LLM generator (`generate_and_save`)**
- Used when `generate_projects=true` or non-standard format. 3-phase: keyword extraction → `tailor_resume` (huge ATS-optimized system prompt producing structured JSON) → ATS scoring with **up to 2 retries** that feed missing keywords back as feedback until score ≥ 80%. Post-processing enforces a forced target job title and validates `core_competencies` against the source-context text to strip fabricated cross-domain claims.
- Both engines render via the same `_create_resume_docx` (Tahoma, 0.5" margins, single-column, ALL-CAPS underlined section headers, simple bullets, no tables/images — ATS-safe). Routing in `server.py::/api/generate-resume`; output filename sanitized + timestamped into `generated_resumes/`.

### 6. Unified / cross-job resume
- `POST /api/history/cross-analysis` (preview) and `POST /api/generate-unified-resume`: aggregate parsed_data across selected tracked jobs (`synthesize_cross_job_analysis` — local frequency counting of required/preferred skills, seniority/work-type consensus, salary/experience ranges, common responsibilities + an LLM "targeting brief"). The synthesis is rendered into an `analysis_context` block prepended to a combined JD, then fed to Engine B to produce one resume covering all listings. Supports `target_job_title`, `project_themes`, `experience_themes` overrides.
- `POST /api/resume-theme-suggestions`: LLM proposes 8-10 polished job titles + project themes + experience themes (with priority) for the user to pick from before unified generation.

### 7. Application Q&A helper
- `POST /api/history/{job_id}/answer-question`: answers free-form application questions in first-person plain text (markdown stripped) using the JD + extracted resume text (from the generated resume PDF/DOCX, or pasted custom resume, or master profile fallback). `gemini_client.answer_application_question`.

### 8. Bank editor + AI authoring assists
- Full CRUD over the 4 data banks: `GET /api/banks`, `GET/PUT /api/banks/{bank_name}` with structural validation + `.bak` backups (`services/bank_manager.py`).
- AI authoring endpoints: generate ATS aliases for a skill, generate per-context bullet variants from a base description, generate per-role project bullets, suggest new skills from a JD (excluding existing), polish a bullet. All in `gemini_client.py`; surfaced inline in the React Bank Editor.

### 9. Platform authentication & autofill
- `services/auth_manager.py`: `POST /api/auth/login/{platform}` opens a **headful persistent Chrome context** at the platform login page and polls (up to 10 min) until the user closes all pages; cookies persist in `user_sessions/{platform}_profile`. `is_authenticated` checks legacy JSON cookies (`li_at` etc.) or a non-trivial persistent Cookies file. Logout deletes the JSON + profile dir.
- `services/autofill_manager.py`: pre-seeds Chrome's **`Web Data` SQLite autofill DB** (autofill, autofill_profiles, names/emails/phones tables + many common field-name aliases) from the user profile so native browser autofill works on application forms.

## AI Capabilities

All via `gemini-2.0-flash`, all **batch (non-streaming)** request/response. No tool/function calling, no vision, no audio. JSON is requested in-prompt and parsed defensively (strip ```` ```json ````, slice first `{`/last `}`).

- **JD keyword extraction** (`extract_jd_keywords`) — required/preferred skills, responsibilities, industry terms, certifications, soft skills, job title.
- **JD structured parsing** (`job_parser.parse_job_description`) — the `ParsedJobData` schema above.
- **Resume tailoring** (`tailor_resume`) — very large ATS system prompt (semantic keyword integration, multi-section distribution, action-verb/metrics rules, factual-accuracy guardrails, domain-integrity guardrails, career-progression sub-entries, leadership bullets, strict JSON schema). The single most important prompt to preserve.
- **ATS scoring** (`score_resume_match`) — match_score 0-100, matched/missing/critical_missing, suggestions; drives the retry loop and the threshold gate.
- **Summary polish** (`tailor_summary`) — keyword-dense rewrite with domain-integrity guardrail.
- **Cross-job synthesis** (`synthesize_cross_job_analysis`) — local counting + LLM targeting brief.
- **Theme suggestions** (inline in `server.py`) — strategic title/project/experience theme menu.
- **Application question answering** (`answer_application_question`).
- **Bank authoring assists** — `generate_ats_aliases`, `generate_bullet_variants`, `generate_project_bullets`, `suggest_skills_from_jd`, `polish_bullet`.
- **Cover letter** (`generate_cover_letter`) and **form-field mapping** (`map_profile_to_form_fields`) exist in `gemini_client.py` but are not wired to live endpoints in `server.py` (legacy/CLI vestiges).

## UI / UX

Single-page React app, three primary views (Search, Profile, History/Tracker) selected by `currentView`. Notable UI features:
- **Resizable sidebar and tracker panel** (mouse-drag handles, widths persisted).
- **Session restoration** — jobs, filters, selections, panel widths all restored from `sessionStorage` on reload.
- **Live status bar** fed by WebSocket `{type:"status", message}` broadcasts from the backend (search progress, scoring, merge results, etc.).
- **Operation manager** — concurrent background ops tracked in `activeOps` with per-op progress, AbortController cancellation, conflict groups (e.g. only one "gemini" op or one "scraping" op at a time), and auto-dismiss. Generic `processPool(items, worker, {concurrency, signal, onProgress})` runs batch work with bounded parallelism.
- **Batch actions on search results** — multi-select, "fetch & track all", "track all", "open all in Firefox", "generate resumes for all", client-side dedup (`deduplicateJobs`/`normalizeCompany`), hide-tracked, hide-duplicates, salary filter, work-type/country/quick-apply filters.
- **Tracker** — Kanban-like status chips with color coding (`getStatusColor`/`getStatusBgColor`), advanced filter panel, duplicate modal with merge/auto-merge, per-entry resume generation + ATS score display + JD download + Q&A.
- **Bank editor modal** — tabbed editor for the 4 banks with inline AI buttons and dirty-state tracking.
- **No OS-level features** — no overlay, always-on-top, click-through, global hotkeys, tray, cursor control, or multi-monitor handling. "Desktop-ness" is limited to the backend launching headful browsers and spawning Firefox on the user's machine.

## Backend Services

- `server.py` — FastAPI app: ~60 REST endpoints + `/ws` WebSocket; startup launches BrowserManager and loads profile/banks; CORS open `*`; mounts `/resumes` static.
- `services/browser_manager.py` — Playwright lifecycle; incognito context + per-platform persistent contexts; realistic fingerprint (UA rotation, viewport, locale en-US, America/New_York tz, geolocation NYC, sec-fetch headers); applies stealth per page.
- `services/stealth_manager.py` — thin wrapper over `playwright-stealth`.
- `services/auth_manager.py` — interactive persistent-profile login + session detection per platform.
- `services/autofill_manager.py` — seeds Chrome `Web Data` SQLite autofill tables.
- `services/gemini_client.py` — all LLM calls (see AI Capabilities).
- `services/job_parser.py` — JD → `ParsedJobData`; filter-option aggregation.
- `services/history_manager.py` — application_history.json CRUD, dedup, merge, search, stats.
- `services/resume_assembler.py` — deterministic bank-driven resume assembly (flat + nested).
- `services/resume_generator.py` — orchestrates both resume engines + DOCX rendering.
- `services/context_loader.py` — reads `context/*.{txt,md,docx,pdf}` into a combined string for the LLM.
- `services/bank_manager.py` — bank CRUD + validation + backups.
- `platforms/{base_platform,indeed,linkedin,ziprecruiter}.py` — scraping/parsing per board.
- Root scripts `generate_docx_resume.py` (standalone DocxResumeGenerator) and `build_skills_matrix.py` (one-off DE/DS skills-matrix synthesis) are support/auxiliary tooling, not part of the live server flow.

## Data / Persistence

All persistence is **local JSON / files** (no database). Stored items:
- `application_history.json` — every tracked job (status, status_history, parsed_data, resume_path, notes, dedup keys). The system of record.
- `recent_searches.json` (last 15) and `saved_complex_searches.json` (named search sets).
- `context/profile.json` — name, contact, education, certifications (drives deterministic resume header/education).
- `context/skills_bank.json` — skill categories; each skill has `ats_aliases[]`, `contexts[]` (DE/DS/MLOps/SWE), `proficiency`.
- `context/experience_bank.json` — single company with roles; each role has `title_canonical`, per-context `title_variants`, per-context `scope_bullets`, and a `bullet_pool` of multi-context `variants`.
- `context/project_bank.json` — projects with `role_id` link, `technologies`, `timeline`, `type`, `applicable_roles[]`, per-context `bullet_variants`.
- `user_profile.json` — separate legacy master profile used by Engine B and the CLI (distinct from `context/profile.json`).
- `context/*.{pdf,docx,txt,md}` — uploaded context documents fed to the LLM.
- `generated_resumes/` — output DOCX/PDF artifacts.
- `user_sessions/{platform}_profile/` — Playwright persistent browser profiles (cookies + seeded autofill SQLite).
- Auth, no transcript/audio storage. `auth_debug.log` for login debugging.

## Reusable Patterns

- **Data-bank-driven deterministic resume assembly** with per-context (DE/DS/MLOps/SWE) variants for titles, scope bullets, experience bullets, and project bullets — selected by JD keyword scoring. This decouples "what's true about me" from "how it's framed per role" and dramatically cuts LLM cost/hallucination vs full-LLM generation. (`resume_assembler.py`)
- **Generate → ATS-score → retry-with-missing-keywords loop** with a format-aware pass/fail threshold (Engine B), plus post-gen domain-integrity validation that strips fabricated cross-domain claims.
- **Concurrency pool + operation manager** on the frontend: bounded-parallel batch worker, AbortController cancellation, and conflict groups preventing incompatible ops (e.g. two scraping jobs) from overlapping. (`processPool`, `activeOps` in `App.jsx`)
- **Multi-key dedup** (exact id/url → platform job-id → title|company fingerprint) and **smart merge** preserving best status/longest description/richest metadata. (`history_manager.py`)
- **Defensive LLM-JSON parsing** helper pattern (strip fences, slice first/last brace) reused across every Gemini call.
- **Persistent-profile + seeded-SQLite-autofill** approach to surviving logins and enabling native browser autofill on arbitrary application forms.
- **WebSocket status broadcast** as a simple one-way progress channel for long scraping/AI operations.
- **Per-board scraper with layered selector fallbacks + human-emulation delays + stealth** as a template for resilient scraping.

## Limitations / Tech Debt

- **Monolithic files:** `App.jsx` is 6,247 lines of one component with ~80 handlers and dozens of `useState`; `server.py` is ~1,800 lines. No componentization, no router, no state library, no shared API client.
- **"Pro" model is a no-op:** both `self.model` and `self.pro_model` are `gemini-2.0-flash` despite CLAUDE.md claiming a separate pro model for resume generation. A rebuild should pick deliberate models (e.g. Claude Opus for generation, a cheaper model for utility passes).
- **No streaming AI**, no function/tool calling, no vision — everything is single-shot text JSON, with brittle brace-slicing parsing instead of structured outputs.
- **Hardcoded endpoints:** `App.jsx` uses `http://localhost:8000` and `ws://localhost:8000/ws` directly, bypassing the Vite proxy and the `ports.json` mechanism the backend respects.
- **Two competing profile sources** (`user_profile.json` vs `context/profile.json`) and **two resume engines** with overlapping responsibilities — confusing and easy to desync.
- **Scraper fragility:** hardcoded CSS selectors per board break when sites change; LinkedIn/Indeed/ZipRecruiter anti-bot frequently forces auth walls/CAPTCHAs; CAPTCHA "solving" is manual.
- **Single global browser + module-global mutable state** (`cached_jobs`, `connected_websockets`, viewer sessions) — not multi-user/concurrent-safe.
- **Windows-centric:** Firefox path discovery and `restart_servers.bat` assume Windows, though the rest is cross-platform.
- **`auth_manager.login()` is dead/abandoned** (full of stream-of-consciousness comments); only `login_interactive()` works. `generate_cover_letter`/`map_profile_to_form_fields` are unused.
- **Security:** open CORS `*`, `subprocess.Popen` of a browser with user-supplied URLs, profile JSON written to disk unencrypted, real PII committed in `context/profile.json`/`user_profile.json`.
- ATS "scoring" is the LLM grading its own output — directionally useful but not an objective metric.

## Unique Value (vs other assistants in this collection)

This is the only assistant that is a **full job-search operations pipeline**, not a conversational/realtime helper. Its differentiators: (1) a **deterministic, data-bank-driven resume engine** with per-role (DE/DS/MLOps/SWE) bullet/title variants selected by JD keyword scoring — not just "ask the LLM to write a resume"; (2) **stealth multi-board scraping** with pagination, salary/date normalization, and quick-apply detection across Indeed/LinkedIn/ZipRecruiter; (3) a **local application tracker** with multi-key dedup, smart merge, status history, and rich advanced filtering driven by AI-parsed JD metadata; (4) **cross-job "unified resume"** synthesis optimizing one resume against many target listings at once; (5) **persistent-profile auth + Chrome SQLite autofill seeding** to carry logins and auto-fill external application forms; and (6) a generate→ATS-score→retry feedback loop with domain-integrity guardrails against resume fabrication. No audio/video/realtime anything.
