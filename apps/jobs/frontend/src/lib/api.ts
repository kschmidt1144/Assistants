import type { Application, ParsedJob, TailorResult } from "./types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}
function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export interface CreateApp {
  title?: string | null;
  company?: string | null;
  url?: string | null;
  location?: string | null;
  jd_text?: string | null;
  parsed_data?: ParsedJob | null;
}

export const api = {
  statuses: () => req<string[]>("/api/statuses"),
  stats: () => req<Record<string, number>>("/api/stats"),

  parseJd: (jd_text: string) => req<ParsedJob>("/api/parse-jd", json("POST", { jd_text })),

  createApplication: (body: CreateApp) => req<Application>("/api/applications", json("POST", body)),
  listApplications: (status?: string, query?: string) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (query) p.set("query", query);
    const qs = p.toString();
    return req<Application[]>(`/api/applications${qs ? `?${qs}` : ""}`);
  },
  getApplication: (id: string) => req<Application>(`/api/applications/${id}`),
  updateApplication: (id: string, body: { status?: string; notes?: string }) =>
    req<Application>(`/api/applications/${id}`, json("PUT", body)),
  deleteApplication: (id: string) =>
    req<{ ok: boolean }>(`/api/applications/${id}`, { method: "DELETE" }),

  getProfile: () => req<{ text: string }>("/api/profile"),
  setProfile: (text: string) => req<{ ok: boolean }>("/api/profile", json("POST", { text })),
  uploadProfile: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ ok: boolean; chars: number }>("/api/profile/upload", { method: "POST", body: fd });
  },

  tailor: (body: { application_id?: string; jd_text?: string; target_title?: string }) =>
    req<TailorResult>("/api/tailor", json("POST", body)),
  coverLetter: (body: { application_id?: string; jd_text?: string }) =>
    req<{ cover_letter: string }>("/api/cover-letter", json("POST", body)),
  answerQuestion: (body: { application_id?: string; jd_text?: string; question: string }) =>
    req<{ answer: string }>("/api/answer-question", json("POST", body)),
};
