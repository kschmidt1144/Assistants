# assistants-core (Python)

Shared backend core for the Assistants apps. Provides:

- **`config`** — typed settings from env / `.env` (`get_settings()`).
- **`models`** — the single model registry. Realtime → Gemini Live; reasoning → Claude
  (Opus 4.8 / Sonnet 4.6 / Haiku 4.5). Claude IDs are pinned; the Gemini Live id is overridable
  (open decision #8).
- **`providers`** — `ClaudeClient` (Anthropic SDK: streaming, structured outputs, prompt caching,
  capability-aware thinking/effort), `GeminiLiveBridge` (realtime audio/video/text), `ProviderRouter`.
- **`docs`** — real PDF/DOCX/TXT/MD parsing.
- **`persistence`** — local SQLite (sessions + transcripts).

```sh
python3.13 -m venv ../../.venv && source ../../.venv/bin/activate
pip install -e ".[dev]"
pytest            # offline tests; live API tests are marked `live` and skipped without keys
```
