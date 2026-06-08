"""Smoke-test the configured API keys and model strings against the live providers.

Uses the project's own Settings + model registry, so it validates exactly what the apps will
use. Run: `python scripts/check_keys.py`. Prints PASS/FAIL per check; never prints full keys.
"""

from __future__ import annotations

import sys
import traceback

from assistants_core.config import get_settings
from assistants_core.models import Provider, build_registry

OK = "\033[32mPASS\033[0m"
NO = "\033[31mFAIL\033[0m"
WARN = "\033[33mWARN\033[0m"


def mask(key: str | None) -> str:
    if not key:
        return "(missing)"
    return f"{key[:10]}…{key[-4:]} (len {len(key)})"


def main() -> int:
    settings = get_settings()
    registry = build_registry(settings)
    failures = 0

    print("=" * 70)
    print("KEYS")
    print("=" * 70)
    print(f"  ANTHROPIC_API_KEY : {mask(settings.anthropic_api_key)}")
    print(f"  GOOGLE_API_KEY    : {mask(settings.google_api_key)}")

    claude_ids = sorted({s.model_id for s in registry.values() if s.provider == Provider.ANTHROPIC})
    gemini_ids = sorted({s.model_id for s in registry.values() if s.provider == Provider.GEMINI})

    # ── Anthropic ────────────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("ANTHROPIC / CLAUDE")
    print("=" * 70)
    if not settings.anthropic_api_key:
        print(f"  {NO} no key set")
        failures += 1
    else:
        try:
            from anthropic import Anthropic

            client = Anthropic(api_key=settings.anthropic_api_key)
            served = {m.id for m in client.models.list(limit=1000).data}
            print(f"  {OK} key authenticated — {len(served)} models visible")

            print("\n  Configured model ids:")
            for mid in claude_ids:
                if mid in served:
                    print(f"    {OK} {mid}")
                else:
                    # alias may resolve even if not literally listed → try retrieve
                    try:
                        resolved = client.models.retrieve(mid)
                        print(f"    {OK} {mid}  (resolves → {resolved.id})")
                    except Exception as exc:  # noqa: BLE001
                        print(f"    {NO} {mid}  — {type(exc).__name__}: {exc}")
                        failures += 1

            # one real generation on the cheapest configured model
            from assistants_core.models import ModelRole

            fast_id = registry[ModelRole.REASON_FAST].model_id
            msg = client.messages.create(
                model=fast_id,
                max_tokens=8,
                messages=[{"role": "user", "content": "Reply with the single word: pong"}],
            )
            text = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")
            print(f"\n  {OK} generation on {fast_id} → {text!r} "
                  f"(in={msg.usage.input_tokens} out={msg.usage.output_tokens} tok)")
        except Exception as exc:  # noqa: BLE001
            print(f"  {NO} {type(exc).__name__}: {exc}")
            traceback.print_exc()
            failures += 1

    # ── Google / Gemini ──────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("GOOGLE / GEMINI")
    print("=" * 70)
    if not settings.google_api_key:
        print(f"  {NO} no key set")
        failures += 1
    else:
        try:
            from google import genai

            client = genai.Client(api_key=settings.google_api_key)
            models = list(client.models.list())
            names = {m.name.removeprefix("models/"): m for m in models}
            print(f"  {OK} key authenticated — {len(models)} models visible")

            # Models that can drive a Live (bidirectional) session.
            def actions(m: object) -> list[str]:
                return list(getattr(m, "supported_actions", None) or [])

            live_models = sorted(
                n for n, m in names.items() if "bidiGenerateContent" in actions(m)
            )

            print("\n  Configured Gemini model ids:")
            for mid in gemini_ids:
                bare = mid.removeprefix("models/")
                if bare in names:
                    acts = actions(names[bare])
                    has_live = "bidiGenerateContent" in acts
                    tag = OK if has_live else WARN
                    note = "" if has_live else "  (served, but NOT Live-capable!)"
                    print(f"    {tag} {mid}{note}")
                    if not has_live:
                        failures += 1
                else:
                    print(f"    {NO} {mid}  — not served by this key")
                    failures += 1

            print(f"\n  Live-capable (bidiGenerateContent) models served by this key "
                  f"({len(live_models)}):")
            for n in live_models:
                star = "  ← native-audio" if "native-audio" in n else ""
                print(f"      {n}{star}")
            if not live_models:
                print("      (none — this key may not have Live API access)")
        except Exception as exc:  # noqa: BLE001
            print(f"  {NO} {type(exc).__name__}: {exc}")
            traceback.print_exc()
            failures += 1

    print("\n" + "=" * 70)
    print(f"{'ALL CHECKS PASSED' if failures == 0 else str(failures) + ' CHECK(S) FAILED'}")
    print("=" * 70)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
