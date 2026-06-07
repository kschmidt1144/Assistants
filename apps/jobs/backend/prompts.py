"""System prompts + structured-output schemas for the Job Application Assistant."""

from assistants_core import object_schema

# ── prompts ───────────────────────────────────────────────────────────────────
PARSE_SYSTEM = (
    "You extract structured metadata from a job description. Be faithful to the text; if a field "
    "isn't stated, use a reasonable empty/'unknown' value rather than inventing it."
)

# The single most important prompt to preserve from the prototype: ATS tailoring WITH a strict
# factual-integrity guardrail.
TAILOR_SYSTEM = (
    "You are an expert resume writer tailoring a candidate's resume to a specific job, for both ATS "
    "keyword matching and human reviewers. Work ONLY from the candidate's real experience in their "
    "profile/master resume — reframe, reorder, and emphasize to match the job, and integrate the "
    "job's keywords naturally WHERE the candidate genuinely has that experience.\n"
    "DOMAIN-INTEGRITY GUARDRAIL: never invent employers, titles, dates, degrees, certifications, or "
    "skills the candidate does not actually have. Do not claim domain experience that isn't in the "
    "profile. Use strong action verbs and keep quantified impact that appears in the profile."
)

ATS_SYSTEM = (
    "You simulate an ATS screen. Compare the resume to the job description and return: a 0-100 match "
    "score, the important job keywords/skills present in the resume (matched), those missing, and "
    "concrete suggestions. Judge only on the provided resume text."
)

COVER_SYSTEM = (
    "Write a concise, specific cover letter (markdown, ~3 short paragraphs, first person) for this "
    "candidate and job, grounded ONLY in the candidate's real experience. No clichés or filler."
)

QA_SYSTEM = (
    "Answer the job-application question in first person as the candidate, grounded ONLY in their real "
    "experience from the profile. Be concise and specific. Plain prose — no markdown headings."
)

# ── schemas (structured outputs; replaces the prototype's brace-slicing) ───────
PARSED_JOB_SCHEMA = object_schema(
    {
        "title": {"type": "string"},
        "company": {"type": "string"},
        "seniority": {"type": "string"},
        "work_type": {"type": "string"},
        "employment_type": {"type": "string"},
        "min_years_experience": {"type": "integer"},
        "salary_text": {"type": "string"},
        "required_skills": {"type": "array", "items": {"type": "string"}},
        "preferred_skills": {"type": "array", "items": {"type": "string"}},
        "key_responsibilities": {"type": "array", "items": {"type": "string"}},
    },
    required=[
        "title", "company", "seniority", "work_type", "employment_type",
        "min_years_experience", "salary_text", "required_skills", "preferred_skills",
        "key_responsibilities",
    ],
)

RESUME_SCHEMA = object_schema(
    {
        "summary": {"type": "string"},
        "skills": {"type": "array", "items": {"type": "string"}},
        "experience": {
            "type": "array",
            "items": object_schema(
                {
                    "title": {"type": "string"},
                    "company": {"type": "string"},
                    "dates": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                },
                required=["title", "company", "dates", "bullets"],
            ),
        },
        "projects": {
            "type": "array",
            "items": object_schema(
                {"name": {"type": "string"}, "bullets": {"type": "array", "items": {"type": "string"}}},
                required=["name", "bullets"],
            ),
        },
    },
    required=["summary", "skills", "experience", "projects"],
)

ATS_SCHEMA = object_schema(
    {
        "score": {"type": "integer"},
        "matched": {"type": "array", "items": {"type": "string"}},
        "missing": {"type": "array", "items": {"type": "string"}},
        "suggestions": {"type": "array", "items": {"type": "string"}},
    },
    required=["score", "matched", "missing", "suggestions"],
)
