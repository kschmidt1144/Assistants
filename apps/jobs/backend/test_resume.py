from typing import Any

from resume import render_resume, tailor_and_score


class FakeClaude:
    """Returns a canned resume for the resume schema and a scripted score for the ATS schema."""

    def __init__(self, scores: list[int]) -> None:
        self.scores = list(scores)
        self.tailor_calls = 0
        self.prompts: list[tuple[str, Any]] = []

    async def reason_structured(self, *, schema: dict[str, Any], role: Any, system: str, messages: Any) -> Any:
        self.prompts.append((system, messages))
        if "summary" in schema.get("properties", {}):
            self.tailor_calls += 1
            return {
                "summary": "Senior engineer.",
                "skills": ["Python", "AWS"],
                "experience": [{"title": "Eng", "company": "X", "dates": "2020–24", "bullets": ["Built pipelines"]}],
                "projects": [],
            }
        score = self.scores.pop(0) if self.scores else 90
        return {"score": score, "matched": ["Python"], "missing": ["MISSING_KEYWORD"], "suggestions": ["add AWS"]}


def test_render_resume_markdown():
    md = render_resume(
        {
            "summary": "S",
            "skills": ["Python"],
            "experience": [{"title": "Eng", "company": "X", "dates": "2020", "bullets": ["did x"]}],
            "projects": [{"name": "Proj Y", "bullets": ["React project"]}],
        }
    )
    assert "## Summary" in md
    assert "## Experience" in md
    assert "- did x" in md
    assert "## Projects" in md
    assert "Proj Y" in md
    assert "React project" in md

def test_render_resume_missing_keys():
    # Empty dictionary, missing keys
    md = render_resume({})
    assert "## Summary" not in md
    
    # Special chars
    md = render_resume({
        "summary": "C++ & C#",
        "experience": []
    })
    assert "C++ & C#" in md
    assert "## Experience" not in md

async def test_retry_loop_stops_on_threshold():
    fake = FakeClaude([50, 90])
    out = await tailor_and_score(fake, profile_text="p", jd_text="j", threshold=80, max_iterations=3)
    assert out["iterations"] == 2  # 50 (<80) → retry → 90 (>=80) → stop
    assert out["ats"]["score"] == 90
    assert "## Summary" in out["resume_markdown"]
    
    # Check that feedback prompt contains the missing keywords and do not fabricate rule
    # The second tailor call should have feedback in messages
    tailor_prompts = [p for p in fake.prompts if "expert resume writer" in p[0]]
    assert len(tailor_prompts) == 2
    # The feedback is appended to the message prompt
    second_tailor_msg = str(tailor_prompts[1][1])
    assert "MISSING_KEYWORD" in second_tailor_msg
    assert "do not fabricate" in second_tailor_msg.lower()

async def test_retry_loop_respects_max_iterations():
    fake = FakeClaude([10, 20, 30])
    out = await tailor_and_score(fake, profile_text="p", jd_text="j", threshold=80, max_iterations=2)
    assert out["iterations"] == 2  # never crosses threshold; capped at max_iterations
    assert out["ats"]["score"] == 20

async def test_retry_loop_first_score_high():
    fake = FakeClaude([90])
    out = await tailor_and_score(fake, profile_text="p", jd_text="j", threshold=80, max_iterations=3)
    assert out["iterations"] == 1
    assert out["ats"]["score"] == 90
    assert fake.tailor_calls == 1

async def test_retry_loop_max_iterations_one():
    fake = FakeClaude([10])
    out = await tailor_and_score(fake, profile_text="p", jd_text="j", threshold=80, max_iterations=1)
    assert out["iterations"] == 1
    assert out["ats"]["score"] == 10
    assert fake.tailor_calls == 1
