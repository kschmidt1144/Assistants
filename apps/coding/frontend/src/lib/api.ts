/** Thin client for the coding backend (proxied through Vite at /api). */

export interface AnalyzeRequest {
  text: string;
  image?: string | null;
  context?: string | null;
  role?: string;
}
export interface AnalyzeResponse {
  response: string;
  model: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  analyze: (req: AnalyzeRequest) => postJson<AnalyzeResponse>("/api/analyze", req),
  ocr: (image: string) => postJson<{ text: string }>("/api/ocr", { image }),
};
