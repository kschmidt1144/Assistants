export interface ParsedJob {
  title: string;
  company: string;
  seniority: string;
  work_type: string;
  employment_type: string;
  min_years_experience: number;
  salary_text: string;
  required_skills: string[];
  preferred_skills: string[];
  key_responsibilities: string[];
}

export interface Application {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
  jd_text: string | null;
  parsed_data: ParsedJob | null;
  status: string;
  status_history: { status: string; date: number }[];
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface AtsResult {
  score: number;
  matched: string[];
  missing: string[];
  suggestions: string[];
}

export interface TailorResult {
  resume_markdown: string;
  ats: AtsResult;
  iterations: number;
}
