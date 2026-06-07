"""The single source of truth for which model plays which role.

Design (REBUILD_PLAN.md §5): realtime audio/video → Gemini Live (Claude has no realtime API);
deep reasoning → Claude. Claude model ids are pinned and verified; the Gemini Live id is a
placeholder pending open decision #8 and is overridable via `GEMINI_LIVE_MODEL`.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .config import Settings


class Provider(StrEnum):
    GEMINI = "gemini"
    ANTHROPIC = "anthropic"


class ModelRole(StrEnum):
    REALTIME = "realtime"  # bidirectional audio/video streaming + live transcription
    REASON_DEEP = "reason_deep"  # hardest reasoning: analysis, summaries, resume tailoring
    REASON_BALANCED = "reason_balanced"  # everyday reasoning at lower cost
    REASON_FAST = "reason_fast"  # cheap utility passes: extraction, classification, scoring


@dataclass(frozen=True)
class ModelSpec:
    role: ModelRole
    provider: Provider
    model_id: str
    context_window: int
    supports_thinking: bool = False  # adaptive thinking param accepted
    supports_effort: bool = False  # output_config.effort accepted
    note: str = ""


# Claude ids — verified against the current model catalog (REBUILD_PLAN.md §5).
CLAUDE_DEEP = "claude-opus-4-8"
CLAUDE_BALANCED = "claude-sonnet-4-6"
CLAUDE_FAST = "claude-haiku-4-5"

# Decision #8: native-audio Gemini Live model (Option B). Replies with audio + transcription;
# the bridge requests AUDIO modality + transcription accordingly. Override via GEMINI_LIVE_MODEL
# (e.g. gemini-3.1-flash-live-preview). Verify it's served by your key: client.models.list().
DEFAULT_GEMINI_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"


def build_registry(settings: Settings) -> dict[ModelRole, ModelSpec]:
    """Resolve the role→model map, applying any env overrides from `settings`."""
    return {
        ModelRole.REALTIME: ModelSpec(
            role=ModelRole.REALTIME,
            provider=Provider.GEMINI,
            model_id=settings.gemini_live_model or DEFAULT_GEMINI_LIVE_MODEL,
            context_window=1_000_000,
            note="Gemini Live native-audio (AUDIO out + transcription); override via GEMINI_LIVE_MODEL",
        ),
        ModelRole.REASON_DEEP: ModelSpec(
            role=ModelRole.REASON_DEEP,
            provider=Provider.ANTHROPIC,
            model_id=settings.claude_deep_model or CLAUDE_DEEP,
            context_window=1_000_000,
            supports_thinking=True,
            supports_effort=True,  # Opus tier: low/medium/high/xhigh/max
        ),
        ModelRole.REASON_BALANCED: ModelSpec(
            role=ModelRole.REASON_BALANCED,
            provider=Provider.ANTHROPIC,
            model_id=settings.claude_balanced_model or CLAUDE_BALANCED,
            context_window=1_000_000,
            supports_thinking=True,
            supports_effort=True,  # Sonnet 4.6: low/medium/high
        ),
        ModelRole.REASON_FAST: ModelSpec(
            role=ModelRole.REASON_FAST,
            provider=Provider.ANTHROPIC,
            model_id=settings.claude_fast_model or CLAUDE_FAST,
            context_window=200_000,
            supports_thinking=False,  # Haiku 4.5 rejects effort + adaptive thinking
            supports_effort=False,
        ),
    }
