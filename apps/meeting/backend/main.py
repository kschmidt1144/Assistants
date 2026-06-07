"""Meeting Copilot — backend. Local-only (decision #6): local SQLite, no auth, no cloud.

Transcription happens in-browser (Web Speech). This backend provides:
  • local speaker-ID (voice embeddings, decision #7): /api/identify-speaker, /api/enroll-speaker, /api/voice-profiles
  • AI notes (Claude): /api/summarize, /api/action-items, /api/clean-transcript, /api/ask
  • meeting persistence (SQLite): /api/meetings ...

Run:  ../../../.venv/bin/uvicorn main:app --reload --port 8002
"""

from __future__ import annotations

import base64
from contextlib import asynccontextmanager
from typing import Any

from assistants_core import (
    Database,
    ProviderRouter,
    SpeakerIdentifier,
    get_settings,
    object_schema,
    pcm16_to_float32,
    user_text,
)
from assistants_core.models import ModelRole
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from prompts import ACTION_ITEMS_SYSTEM, ASK_SYSTEM, CLEAN_SYSTEM, SUMMARY_SYSTEM
from pydantic import BaseModel

APP_NAME = "meeting"
router = ProviderRouter()

_state: dict[str, Any] = {"db": None, "identifier": None}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db = await Database(get_settings().db_path).connect()
    _state["db"] = db
    _state["identifier"] = SpeakerIdentifier(db)
    try:
        yield
    finally:
        await db.close()


app = FastAPI(title="Meeting Copilot", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def db() -> Database:
    if _state["db"] is None:
        raise HTTPException(503, "database not ready")
    return _state["db"]


def identifier() -> SpeakerIdentifier:
    if _state["identifier"] is None:
        raise HTTPException(503, "speaker identifier not ready")
    return _state["identifier"]


def _require_anthropic() -> None:
    if not get_settings().has_anthropic:
        raise HTTPException(400, "ANTHROPIC_API_KEY not set")


# ── meta ──────────────────────────────────────────────────────────────────────
@app.get("/health")
def health() -> dict[str, object]:
    s = get_settings()
    return {"status": "ok", "app": APP_NAME, "anthropic": s.has_anthropic, "google": s.has_google}


@app.get("/api/models")
def models() -> dict[str, dict[str, object]]:
    return {
        role.value: {"provider": spec.provider.value, "model_id": spec.model_id}
        for role, spec in router.registry.items()
    }


# ── speaker identification (local embeddings, #7) ─────────────────────────────
class IdentifyRequest(BaseModel):
    audio: str  # base64 PCM16 16kHz mono


class EnrollRequest(BaseModel):
    name: str
    samples: list[str]  # base64 PCM16 clips


@app.post("/api/identify-speaker")
async def identify_speaker(req: IdentifyRequest) -> dict[str, object]:
    wav = pcm16_to_float32(base64.b64decode(req.audio))
    name, score = await identifier().identify(wav)
    return {"speaker": name, "score": score}


@app.post("/api/enroll-speaker")
async def enroll_speaker(req: EnrollRequest) -> dict[str, object]:
    clips = [pcm16_to_float32(base64.b64decode(s)) for s in req.samples]
    return await identifier().enroll(req.name, clips)


@app.get("/api/voice-profiles")
async def voice_profiles() -> list[dict[str, object]]:
    return await db().list_voice_profiles()


@app.delete("/api/voice-profiles/{name}")
async def delete_voice_profile(name: str) -> dict[str, bool]:
    await db().delete_voice_profile(name)
    return {"ok": True}


# ── AI notes (Claude) ─────────────────────────────────────────────────────────
class TranscriptRequest(BaseModel):
    transcript: str


class AskRequest(BaseModel):
    transcript: str
    question: str


_ACTION_ITEMS_SCHEMA = object_schema(
    {
        "items": {
            "type": "array",
            "items": object_schema(
                {"action": {"type": "string"}, "owner": {"type": "string"}},
                required=["action", "owner"],
            ),
        }
    },
    required=["items"],
)


@app.post("/api/summarize")
async def summarize(req: TranscriptRequest) -> dict[str, str]:
    _require_anthropic()
    out = await router.claude.reason(
        role=ModelRole.REASON_BALANCED, system=SUMMARY_SYSTEM, messages=[user_text(req.transcript)]
    )
    return {"summary": out}


@app.post("/api/action-items")
async def action_items(req: TranscriptRequest) -> dict[str, Any]:
    _require_anthropic()
    return await router.claude.reason_structured(
        schema=_ACTION_ITEMS_SCHEMA,
        role=ModelRole.REASON_BALANCED,
        system=ACTION_ITEMS_SYSTEM,
        messages=[user_text(req.transcript)],
    )


@app.post("/api/clean-transcript")
async def clean_transcript(req: TranscriptRequest) -> dict[str, str]:
    _require_anthropic()
    out = await router.claude.reason(
        role=ModelRole.REASON_FAST,
        system=CLEAN_SYSTEM,
        messages=[user_text(req.transcript)],
        thinking=False,
    )
    return {"cleaned": out}


@app.post("/api/ask")
async def ask(req: AskRequest) -> dict[str, str]:
    _require_anthropic()
    prompt = f"Transcript:\n{req.transcript}\n\nQuestion: {req.question}"
    out = await router.claude.reason(
        role=ModelRole.REASON_DEEP, system=ASK_SYSTEM, messages=[user_text(prompt)]
    )
    return {"answer": out}


# ── meeting persistence (SQLite) ──────────────────────────────────────────────
class CreateMeeting(BaseModel):
    title: str | None = None


class EntryIn(BaseModel):
    speaker: str | None = None
    text: str
    ts: float | None = None


class AppendEntries(BaseModel):
    entries: list[EntryIn]


class UpdateMeeting(BaseModel):
    title: str | None = None
    summary: str | None = None


@app.post("/api/meetings")
async def create_meeting(req: CreateMeeting) -> dict[str, object]:
    session = await db().create_session(app=APP_NAME, title=req.title)
    # one transcript per meeting, keyed by the session id for simplicity
    await db().create_transcript(transcript_id=session["id"], session_id=session["id"], name="transcript")
    return {"id": session["id"], "title": session["title"]}


@app.get("/api/meetings")
async def list_meetings() -> list[dict[str, object]]:
    return await db().list_sessions(app=APP_NAME)


@app.get("/api/meetings/{meeting_id}")
async def get_meeting(meeting_id: str) -> dict[str, object]:
    session = await db().get_session(meeting_id)
    if not session:
        raise HTTPException(404, "meeting not found")
    entries = await db().get_entries(meeting_id)
    return {"session": session, "entries": entries}


@app.post("/api/meetings/{meeting_id}/entries")
async def append_entries(meeting_id: str, req: AppendEntries) -> dict[str, int]:
    for e in req.entries:
        await db().add_entry(transcript_id=meeting_id, text=e.text, speaker=e.speaker, ts=e.ts)
    return {"added": len(req.entries)}


@app.put("/api/meetings/{meeting_id}")
async def update_meeting(meeting_id: str, req: UpdateMeeting) -> dict[str, bool]:
    metadata = {"summary": req.summary} if req.summary is not None else None
    await db().update_session(meeting_id, title=req.title, metadata=metadata)
    return {"ok": True}
