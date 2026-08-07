"""Interview practice mode — a spoken mock interview over Gemini Live, graded by Claude.

A "pack" is a markdown file describing one interview (persona + flow + grading facts), authored
outside this repo (default: the jobsearch repo's interview-prep/mock/). The Live session gets only
the persona/flow half; the grading half is reserved for the post-session debrief so the mock
interviewer can't leak model answers. Session transcripts + scorecards are saved next to the packs.

Ethics note: this is *practice* — the candidate talks to an AI interviewer before a real interview.
It is unrelated to the covert live-assist Interview Copilot that REBUILD_PLAN.md §v2 dropped.
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path

from assistants_core import ProviderRouter, RealtimeSession, get_settings, user_text
from assistants_core.models import ModelRole
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

interview_router = APIRouter()
_provider = ProviderRouter()

PACKS_DIR = Path(
    os.environ.get("INTERVIEW_PACKS_DIR", "~/Repos/jobsearch/interview-prep/mock")
).expanduser()
GRADING_MARKER = "## GRADING FACTS"

INTERVIEWER_PREAMBLE = """\
You are conducting a MOCK job interview by voice, playing the interviewer described below. Rules:

- Stay in character the entire session. You are the interviewer, not a coach; if asked how an
  answer landed, say feedback comes in the written debrief afterwards.
- SPOKEN style: short, natural turns — one or two sentences of reaction, then ONE question.
  Never ask two questions at once. Never lecture or summarize the candidate's answer back.
- Follow the FLOW section, but converse naturally — react to what was actually said, and ask the
  follow-up probes where the flow suggests them.
- If an answer runs well past two minutes, interject politely ("In the interest of time, let me
  stop you there") and move on. That discipline is part of the practice.
- Never volunteer facts about the candidate's background; only probe what they claim.
- When you receive the text [BEGIN_INTERVIEW], greet the candidate and start the flow.
- Messages of the form [CONTROL: ...] are buttons pressed in the practice tool, NOT words spoken
  by the candidate. Obey them immediately and briefly, in character, without commenting on the
  mechanism: "repeat" → restate the current question; "skip" → move to the next flow item;
  "pause" → say you'll wait, then stay silent until the candidate speaks again.
- When the flow is complete, thank them, tell them the written debrief is next, and say goodbye.
"""

DEBRIEF_SYSTEM = """\
You are an interview coach writing a post-mock-interview debrief. You are given (1) the grading
facts and scoring rubric for this interview, and (2) the full transcript with per-answer timings.

Write a markdown scorecard:
1. **Verdict** — one paragraph: would this interviewer advance the candidate? Be honest, not kind.
2. **Answer-by-answer** — for each substantive question: the question, a 1–5 score, what worked,
   what to fix. Quote the candidate's actual words when flagging a problem.
3. **Red flags** — every automatic-fail flag from the grading facts that occurred, quoted. If none,
   say so explicitly.
4. **Timing** — answers over the 90-second target, with durations.
5. **Top 3 fixes** — the highest-leverage changes before the real interview, most important first.

Ground every judgment in the grading facts. Where the candidate said something the facts mark as
unverified or never-claim, flag it in **bold**. Do not invent facts about the candidate."""


def _packs() -> dict[str, Path]:
    if not PACKS_DIR.is_dir():
        return {}
    return {p.stem: p for p in sorted(PACKS_DIR.glob("*.md"))}


def _load_pack(name: str) -> tuple[str, str, str]:
    """Return (title, interviewer_half, grading_half) for a pack, or 404."""
    path = _packs().get(name)
    if path is None:
        raise HTTPException(404, f"unknown pack {name!r} (looked in {PACKS_DIR})")
    text = path.read_text(encoding="utf-8")
    m = re.search(r"^#\s+(.+)$", text, flags=re.MULTILINE)
    title = m.group(1).strip() if m else name
    if GRADING_MARKER in text:
        interviewer_half, grading_half = text.split(GRADING_MARKER, 1)
        grading_half = GRADING_MARKER + grading_half
    else:
        interviewer_half, grading_half = text, text
    return title, interviewer_half.strip(), grading_half.strip()


# ── pack discovery ────────────────────────────────────────────────────────────
@interview_router.get("/api/interview/packs")
def list_packs() -> list[dict[str, str]]:
    out = []
    for name in _packs():
        title, _, _ = _load_pack(name)
        out.append({"name": name, "title": title})
    return out


@interview_router.get("/api/interview/packs/{name}")
def get_pack(name: str) -> dict[str, str]:
    title, interviewer_half, _ = _load_pack(name)
    return {"name": name, "title": title, "system": f"{INTERVIEWER_PREAMBLE}\n{interviewer_half}"}


# ── the live session ──────────────────────────────────────────────────────────
@interview_router.websocket("/ws/interview")
async def ws_interview(ws: WebSocket) -> None:
    await ws.accept()
    session = RealtimeSession(
        _provider.gemini_live(),
        ws.send_json,
        base_system=INTERVIEWER_PREAMBLE,  # fallback; the client sends the pack via config
    )
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


# ── debrief ───────────────────────────────────────────────────────────────────
class TranscriptEntry(BaseModel):
    speaker: str  # "interviewer" | "candidate"
    text: str
    seconds: float | None = None  # candidate answer duration, measured client-side


class DebriefReq(BaseModel):
    pack: str
    transcript: list[TranscriptEntry]
    duration_seconds: float | None = None


def _format_transcript(entries: list[TranscriptEntry]) -> str:
    lines = []
    for e in entries:
        timing = f"  [{e.seconds:.0f}s]" if e.speaker == "candidate" and e.seconds else ""
        lines.append(f"**{e.speaker.upper()}**{timing}: {e.text.strip()}")
    return "\n\n".join(lines)


@interview_router.post("/api/interview/debrief")
async def debrief(req: DebriefReq) -> dict[str, str]:
    if not get_settings().has_anthropic:
        raise HTTPException(400, "ANTHROPIC_API_KEY not set")
    if not req.transcript:
        raise HTTPException(400, "empty transcript")
    title, _, grading_half = _load_pack(req.pack)

    total = f"\nTotal session length: {req.duration_seconds / 60:.0f} min." if req.duration_seconds else ""
    prompt = (
        f"Interview: {title}{total}\n\n## Grading material\n\n{grading_half}"
        f"\n\n## Transcript\n\n{_format_transcript(req.transcript)}"
    )
    scorecard = await _provider.claude.reason(
        role=ModelRole.REASON_DEEP, system=DEBRIEF_SYSTEM, messages=[user_text(prompt)]
    )

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    out_path = PACKS_DIR / "sessions" / f"{stamp}-{req.pack}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        f"# Mock session — {title}\n\n_{datetime.now():%Y-%m-%d %H:%M}_\n\n"
        f"## Scorecard\n\n{scorecard}\n\n## Transcript\n\n{_format_transcript(req.transcript)}\n",
        encoding="utf-8",
    )
    return {"scorecard": scorecard, "saved": str(out_path)}
