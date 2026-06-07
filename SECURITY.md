# Security & privacy

These apps are **local-first** by design (decision #6): each runs on your machine, the backend binds
`127.0.0.1`, and there is **no authentication layer**. That keeps the attack surface small — but it
means a few things are on you.

## Threat model / operating assumptions
- **Don't expose the backends to the network or internet.** They bind loopback (`127.0.0.1`) and have
  no auth. Don't put them behind a public reverse proxy, `--host 0.0.0.0`, or a tunnel without adding
  your own authentication first.
- **Single local user.** No multi-tenant isolation; anything with access to your machine/session can
  use the apps and read the local data.

## Secrets
- API keys live in **`.env`** (gitignored). `.env.example` ships with empty placeholders. **Never
  commit `.env`.**
- Keys are read **server-side** only; the browser never receives them — the FastAPI backend proxies
  all provider calls (Gemini Live / Claude). The realtime WebSocket session is held by the backend.

## Local data
- Transcripts, meetings, tracked applications, your master resume/profile, and **voice profiles** are
  stored **unencrypted** in a local SQLite file (default `./data/assistants.sqlite`, gitignored) and
  generated artifacts under gitignored paths. This is personal (and, for voice profiles,
  biometric-adjacent) data — protect your disk; it is excluded from version control.

## Meeting recording consent
- The Meeting app transcribes audio and can identify speakers. **Laws on recording/transcribing
  conversations vary by jurisdiction** (one-party vs all-party consent). Get consent before recording
  or transcribing a meeting.

## Web boundaries
- CORS on each backend is scoped to that app's localhost frontend origin (not `*`).
- Browser transcription in the Meeting app uses the **Web Speech API**, which (in Chrome) sends audio
  to Google's speech service. It's free and keyless, but it is not fully on-device — avoid it for
  highly sensitive audio, or swap in a local STT model.

## Reporting
This is a personal project with no formal disclosure process. If you find an issue, open a private
note to yourself / an issue in the repo.
