"""Resume tailoring + ATS-score → retry loop (the LLM engine).

generate → score → if below threshold and retries remain, re-tailor with the missing keywords as
feedback. Uses Claude structured outputs (no brittle JSON parsing) with a factual-integrity guardrail.
"""

from __future__ import annotations

from typing import Any

from assistants_core import user_text
from assistants_core.models import ModelRole
from prompts import ATS_SCHEMA, ATS_SYSTEM, RESUME_SCHEMA, TAILOR_SYSTEM


def render_resume(resume: dict[str, Any]) -> str:
    """Structured resume → markdown (also used as the text fed to ATS scoring)."""
    out: list[str] = []
    if resume.get("summary"):
        out.append(f"## Summary\n\n{resume['summary']}")
    if resume.get("skills"):
        out.append("## Skills\n\n" + ", ".join(resume["skills"]))
    if resume.get("experience"):
        out.append("## Experience")
        for e in resume["experience"]:
            out.append(f"\n**{e.get('title', '')}**, {e.get('company', '')} — *{e.get('dates', '')}*")
            out.extend(f"- {b}" for b in e.get("bullets", []))
    if resume.get("projects"):
        out.append("\n## Projects")
        for p in resume["projects"]:
            out.append(f"\n**{p.get('name', '')}**")
            out.extend(f"- {b}" for b in p.get("bullets", []))
    return "\n".join(out)


async def tailor_and_score(
    claude: Any,
    *,
    profile_text: str,
    jd_text: str,
    target_title: str | None = None,
    max_iterations: int = 2,
    threshold: int = 80,
) -> dict[str, Any]:
    feedback = ""
    resume: dict[str, Any] = {}
    ats: dict[str, Any] = {}
    iterations = 0

    while True:
        iterations += 1
        system = TAILOR_SYSTEM + (f"\nTarget job title: {target_title}." if target_title else "")
        prompt = f"Candidate profile / master resume:\n{profile_text}\n\nJob description:\n{jd_text}"
        if feedback:
            prompt += f"\n\n{feedback}"
        resume = await claude.reason_structured(
            schema=RESUME_SCHEMA,
            role=ModelRole.REASON_DEEP,
            system=system,
            messages=[user_text(prompt)],
        )
        resume_md = render_resume(resume)
        ats = await claude.reason_structured(
            schema=ATS_SCHEMA,
            role=ModelRole.REASON_BALANCED,
            system=ATS_SYSTEM,
            messages=[user_text(f"Resume:\n{resume_md}\n\nJob description:\n{jd_text}")],
        )
        if int(ats.get("score", 0)) >= threshold or iterations >= max_iterations:
            break
        missing = ", ".join(ats.get("missing", [])[:15])
        feedback = (
            "The previous draft was missing these job keywords; weave in the ones the candidate "
            f"truthfully has (do not fabricate): {missing}"
        )

    return {
        "resume": resume,
        "resume_markdown": render_resume(resume),
        "ats": ats,
        "iterations": iterations,
    }
