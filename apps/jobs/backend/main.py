"""Job Application Assistant — backend. Non-realtime; manual job intake (no scraping, §1.1).

Reuses the core Claude client + structured outputs + doc parsing. Provides JD parsing, an
application tracker (SQLite), a master profile, and the LLM resume engine (tailor → ATS → retry),
cover letters, and application Q&A.

Run:  ../../../.venv/bin/uvicorn main:app --reload --port 8003
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from assistants_core import ProviderRouter, get_settings, install_cors, parse_document, user_text
from assistants_core.models import ModelRole
from fastapi import FastAPI, File, HTTPException, UploadFile
from interview import interview_router
from practice import practice_router
from prompts import COVER_SYSTEM, PARSE_SYSTEM, PARSED_JOB_SCHEMA, QA_SYSTEM
from pydantic import BaseModel, field_validator
from resume import tailor_and_score
from store import STATUSES, JobsStore

router = ProviderRouter()
_state: dict[str, Any] = {"store": None}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store = await JobsStore(get_settings().db_path).connect()
    _state["store"] = store
    try:
        yield
    finally:
        await store.close()


app = FastAPI(title="Job Application Assistant", lifespan=lifespan)
install_cors(app, ["http://localhost:5175"])  # scoped (not "*"); keeps CORS headers on 500s
app.include_router(interview_router)
app.include_router(practice_router)


def store() -> JobsStore:
    if _state["store"] is None:
        raise HTTPException(503, "store not ready")
    return _state["store"]


def _require_anthropic() -> None:
    if not get_settings().has_anthropic:
        raise HTTPException(400, "ANTHROPIC_API_KEY not set")


async def _resolve_jd(application_id: str | None, jd_text: str | None) -> str:
    if jd_text:
        return jd_text
    if application_id:
        app_row = await store().get_application(application_id)
        if app_row and app_row.get("jd_text"):
            return app_row["jd_text"]
    raise HTTPException(400, "no job description (pass jd_text or a tracked application_id)")


# ── meta ──────────────────────────────────────────────────────────────────────
@app.get("/health")
def health() -> dict[str, object]:
    s = get_settings()
    return {"status": "ok", "app": "jobs", "anthropic": s.has_anthropic, "google": s.has_google}


@app.get("/api/models")
def models() -> dict[str, dict[str, object]]:
    return {role.value: {"provider": spec.provider.value, "model_id": spec.model_id} for role, spec in router.registry.items()}


@app.get("/api/statuses")
def statuses() -> list[str]:
    return STATUSES


# ── JD parsing (structured) ───────────────────────────────────────────────────
class ParseJD(BaseModel):
    jd_text: str


@app.post("/api/parse-jd")
async def parse_jd(req: ParseJD) -> Any:
    _require_anthropic()
    return await router.claude.reason_structured(
        schema=PARSED_JOB_SCHEMA,
        role=ModelRole.REASON_BALANCED,
        system=PARSE_SYSTEM,
        messages=[user_text(req.jd_text)],
    )


# ── application tracker ───────────────────────────────────────────────────────
class CreateApp(BaseModel):
    title: str | None = None
    company: str | None = None
    url: str | None = None
    location: str | None = None
    jd_text: str | None = None
    parsed_data: dict[str, Any] | None = None


class UpdateApp(BaseModel):
    status: str | None = None
    notes: str | None = None

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str | None) -> str | None:
        # K4: reject bogus statuses (→ 422) instead of persisting an off-workflow value.
        if v is not None and v not in STATUSES:
            raise ValueError(f"status must be one of {STATUSES}")
        return v


@app.post("/api/applications")
async def create_application(req: CreateApp) -> dict[str, Any]:
    return await store().upsert_application(
        title=req.title, company=req.company, url=req.url, location=req.location,
        jd_text=req.jd_text, parsed_data=req.parsed_data,
    )


@app.get("/api/applications")
async def list_applications(status: str | None = None, query: str | None = None) -> list[dict[str, Any]]:
    return await store().list_applications(status=status, query=query)


@app.get("/api/applications/{app_id}")
async def get_application(app_id: str) -> dict[str, Any]:
    app_row = await store().get_application(app_id)
    if not app_row:
        raise HTTPException(404, "not found")
    return app_row


@app.put("/api/applications/{app_id}")
async def update_application(app_id: str, req: UpdateApp) -> dict[str, Any]:
    updated = await store().update_application(app_id, status=req.status, notes=req.notes)
    if not updated:
        raise HTTPException(404, "not found")
    return updated


@app.delete("/api/applications/{app_id}")
async def delete_application(app_id: str) -> dict[str, bool]:
    await store().delete_application(app_id)
    return {"ok": True}


@app.get("/api/stats")
async def stats() -> dict[str, int]:
    return await store().stats()


# ── master profile ────────────────────────────────────────────────────────────
class SetProfile(BaseModel):
    text: str


@app.get("/api/profile")
async def get_profile() -> dict[str, str]:
    return {"text": await store().get_profile()}


@app.post("/api/profile")
async def set_profile(req: SetProfile) -> dict[str, bool]:
    await store().set_profile(req.text)
    return {"ok": True}


MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB — a resume well above any real one


@app.post("/api/profile/upload")
async def upload_profile(file: UploadFile = File(...)) -> dict[str, object]:
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"file too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
    filename = file.filename or "resume.txt"
    try:
        text = parse_document(data, filename)
    except ValueError as e:  # unsupported extension — parse_document signals this as ValueError
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001 — corrupt/malformed file (e.g. pypdf) → 400, not 500 (K5)
        raise HTTPException(400, f"could not parse {filename}: {e}") from e
    if not text.strip():
        raise HTTPException(400, "no text could be extracted from the file")
    await store().set_profile(text)
    return {"ok": True, "chars": len(text)}


# ── AI: tailor / cover letter / Q&A / unified ─────────────────────────────────
class TailorReq(BaseModel):
    application_id: str | None = None
    jd_text: str | None = None
    target_title: str | None = None


class CoverReq(BaseModel):
    application_id: str | None = None
    jd_text: str | None = None


class QAReq(BaseModel):
    application_id: str | None = None
    jd_text: str | None = None
    question: str


class UnifiedReq(BaseModel):
    application_ids: list[str]
    target_title: str | None = None


async def _profile_or_400() -> str:
    profile = await store().get_profile()
    if not profile.strip():
        raise HTTPException(400, "set your master profile/resume first")
    return profile


@app.post("/api/tailor")
async def tailor(req: TailorReq) -> dict[str, Any]:
    _require_anthropic()
    jd = await _resolve_jd(req.application_id, req.jd_text)
    profile = await _profile_or_400()
    return await tailor_and_score(router.claude, profile_text=profile, jd_text=jd, target_title=req.target_title)


@app.post("/api/cover-letter")
async def cover_letter(req: CoverReq) -> dict[str, str]:
    _require_anthropic()
    jd = await _resolve_jd(req.application_id, req.jd_text)
    profile = await _profile_or_400()
    out = await router.claude.reason(
        role=ModelRole.REASON_BALANCED,
        system=COVER_SYSTEM,
        messages=[user_text(f"Candidate profile:\n{profile}\n\nJob description:\n{jd}")],
    )
    return {"cover_letter": out}


@app.post("/api/answer-question")
async def answer_question(req: QAReq) -> dict[str, str]:
    _require_anthropic()
    jd = await _resolve_jd(req.application_id, req.jd_text)
    profile = await _profile_or_400()
    prompt = f"Candidate profile:\n{profile}\n\nJob description:\n{jd}\n\nApplication question: {req.question}"
    out = await router.claude.reason(role=ModelRole.REASON_DEEP, system=QA_SYSTEM, messages=[user_text(prompt)])
    return {"answer": out}


@app.post("/api/unified-resume")
async def unified_resume(req: UnifiedReq) -> dict[str, Any]:
    _require_anthropic()
    profile = await _profile_or_400()
    jds: list[str] = []
    for aid in req.application_ids:
        a = await store().get_application(aid)
        if a and a.get("jd_text"):
            label = f"{a.get('title') or ''} @ {a.get('company') or ''}".strip(" @")
            jds.append(f"### {label}\n{a['jd_text']}")
    if not jds:
        raise HTTPException(400, "selected applications have no job descriptions")
    combined = "Optimize one resume across ALL of these target jobs:\n\n" + "\n\n".join(jds)
    return await tailor_and_score(router.claude, profile_text=profile, jd_text=combined, target_title=req.target_title)
