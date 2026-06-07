"""Live provider smoke tests — skipped unless API keys are present.

Run explicitly with keys set:  pytest -m live
"""

import os

import pytest

from assistants_core.config import Settings
from assistants_core.models import ModelRole
from assistants_core.providers import ProviderRouter, user_text

pytestmark = pytest.mark.live


@pytest.mark.skipif(not os.getenv("ANTHROPIC_API_KEY"), reason="no ANTHROPIC_API_KEY")
async def test_claude_fast_smoke():
    router = ProviderRouter(Settings())
    out = await router.claude.reason(
        role=ModelRole.REASON_FAST,
        system="You reply with exactly one word.",
        messages=[user_text("Reply with the word: pong")],
        max_tokens=16,
        thinking=False,
    )
    assert isinstance(out, str) and out.strip()
