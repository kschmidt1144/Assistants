"""Coding Copilot — backend.

Dual-mode AI over a live screen/camera feed (REBUILD_PLAN.md §4.1):
  • Live mode    → realtime commentary via Gemini Live over `WS /ws/live`.
  • Analyze mode → one-shot deep analysis of a captured frame via Claude over `POST /api/analyze`.
  • OCR          → text extraction via Claude (fast) over `POST /api/ocr`.

Run (from this dir, with the repo-root venv):
    ../../../.venv/bin/uvicorn main:app --reload --port 8001
"""

from __future__ import annotations

from assistants_core import ProviderRouter, RealtimeSession, get_settings, user_text, user_with_image
from assistants_core.models import ModelRole
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prompts import CODING_ANALYSIS_SYSTEM, CODING_LIVE_SYSTEM, OCR_PROMPT, OCR_SYSTEM
from pydantic import BaseModel

APP_NAME = "coding"
router = ProviderRouter()

app = FastAPI(title="Coding Copilot")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # scoped (not "*")
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── meta ──────────────────────────────────────────────────────────────────────
@app.get("/health")
def health() -> dict[str, object]:
    s = get_settings()
    return {"status": "ok", "app": APP_NAME, "anthropic": s.has_anthropic, "google": s.has_google}


@app.get("/api/models")
def models() -> dict[str, dict[str, object]]:
    return {
        role.value: {
            "provider": spec.provider.value,
            "model_id": spec.model_id,
            "context_window": spec.context_window,
        }
        for role, spec in router.registry.items()
    }


# ── live mode (Gemini Live over WebSocket) ────────────────────────────────────
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket) -> None:
    await ws.accept()
    session = RealtimeSession(router.gemini_live(), ws.send_json, base_system=CODING_LIVE_SYSTEM)
    try:
        while True:
            msg = await ws.receive_json()
            try:
                await session.handle(msg)
            except Exception as exc:  # noqa: BLE001 — surface to client, keep server up
                await ws.send_json({"type": "error", "data": str(exc)})
                break
    except WebSocketDisconnect:
        pass
    finally:
        await session.close()


# ── analyze mode (Claude deep analysis) ───────────────────────────────────────
_ANALYZE_ROLES = {ModelRole.REASON_DEEP, ModelRole.REASON_BALANCED, ModelRole.REASON_FAST}


class AnalyzeRequest(BaseModel):
    text: str
    image: str | None = None  # base64 JPEG (no data: prefix)
    context: str | None = None  # pinned project context
    role: str = "reason_deep"


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest) -> dict[str, str]:
    if not get_settings().has_anthropic:
        raise HTTPException(400, "ANTHROPIC_API_KEY not set")
    try:
        role = ModelRole(req.role)
    except ValueError:
        role = ModelRole.REASON_DEEP
    if role not in _ANALYZE_ROLES:
        role = ModelRole.REASON_DEEP

    system = CODING_ANALYSIS_SYSTEM
    if req.context:
        system += f"\n\nProject context:\n{req.context}"
    message = user_with_image(req.text, req.image) if req.image else user_text(req.text)

    out = await router.claude.reason(role=role, system=system, messages=[message])
    return {"response": out, "model": router.model_id(role)}


# ── OCR (Claude fast + vision) ────────────────────────────────────────────────
class OcrRequest(BaseModel):
    image: str  # base64 JPEG


@app.post("/api/ocr")
async def ocr(req: OcrRequest) -> dict[str, str]:
    if not get_settings().has_anthropic:
        raise HTTPException(400, "ANTHROPIC_API_KEY not set")
    out = await router.claude.reason(
        role=ModelRole.REASON_FAST,
        system=OCR_SYSTEM,
        messages=[user_with_image(OCR_PROMPT, req.image)],
        thinking=False,
    )
    return {"text": out}
