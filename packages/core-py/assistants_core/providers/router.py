"""Routes each capability to the right provider + model.

A thin internal seam (REBUILD_PLAN.md §5): we're Gemini-Live + Claude only, but keeping the
registry and clients behind one object keeps model ids in a single place and the call sites clean.
"""

from __future__ import annotations

from ..config import Settings, get_settings
from ..models import ModelRole, ModelSpec, build_registry
from .claude import ClaudeClient
from .gemini_live import GeminiLiveBridge


class ProviderRouter:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.registry: dict[ModelRole, ModelSpec] = build_registry(self.settings)
        self._claude: ClaudeClient | None = None

    @property
    def claude(self) -> ClaudeClient:
        if self._claude is None:
            self._claude = ClaudeClient(self.settings.anthropic_api_key, self.registry)
        return self._claude

    def gemini_live(self) -> GeminiLiveBridge:
        """A fresh realtime bridge (one per WebSocket connection)."""
        spec = self.registry[ModelRole.REALTIME]
        return GeminiLiveBridge(self.settings.google_api_key, spec.model_id)

    def model_id(self, role: ModelRole) -> str:
        return self.registry[role].model_id
