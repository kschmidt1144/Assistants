from typing import Any

from resume import render_resume, tailor_and_score


class FakeClaude:
    """Returns a canned resume for the resume schema and a scripted score for the ATS schema."""

    def __init__(self, scores: list[int]) -> None:
        self.scores = list(scores)
        self.tailor_calls = 0

    async def reason_structured(self, *, schema: dict[str, Any], role: Any, system: str, messages: Any) -> Any:
        if "summary" in schema.get("properties", {}):
            self.tailor_calls += 1
            return {
                "summary": "Senior engineer.",
                "skills": ["Python", "AWS"],
                "experience": [{"title": "Eng", "company": "X", "dates": "2020–24", "bullets": ["Built pipelines"]}],
                "projects": [],
            }
        score = self.scores.pop(0) if self.scores else 90
        return {"score": score, "matched": ["Python"], "missing": ["AWS"], "suggestions": ["add AWS"]}


def test_render_resume_markdown():
    md = render_resume(
        {
            "summary": "S",
            "skills": ["Python"],
            "experience": [{"title": "Eng", "company": "X", "dates": "2020", "bullets": ["did x"]}],
            "projects": [],
        }
    )
    assert "## Summary" in md
    assert "## Experience" in md
    assert "- did x" in md


async def test_retry_loop_stops_on_threshold():
    fake = FakeClaude([50, 90])
    out = await tailor_and_score(fake, profile_text="p", jd_text="j", threshold=80, max_iterations=3)
    assert out["iterations"] == 2  # 50 (<80) → retry → 90 (>=80) → stop
    assert out["ats"]["score"] == 90
    assert "## Summary" in out["resume_markdown"]


async def test_retry_loop_respects_max_iterations():
    fake = FakeClaude([10, 20, 30])
    out = await tailor_and_score(fake, profile_text="p", jd_text="j", threshold=80, max_iterations=2)
    assert out["iterations"] == 2  # never crosses threshold; capped at max_iterations
    assert out["ats"]["score"] == 20
