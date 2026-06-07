/** Client for the meeting backend (proxied through Vite at /api → :8002). */

export interface VoiceProfile {
  name: string;
  num_samples: number;
  created_at: number;
}
export interface ActionItem {
  action: string;
  owner: string;
}
export interface MeetingRow {
  id: string;
  title: string | null;
  updated_at: number;
  metadata?: { summary?: string } | null;
}
export interface MeetingEntry {
  id: number;
  ts: number;
  speaker: string | null;
  text: string;
}
export interface MeetingDetail {
  session: { id: string; title: string | null; metadata?: { summary?: string } | null };
  entries: MeetingEntry[];
}
export interface EntryIn {
  speaker?: string | null;
  text: string;
  ts?: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}
function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export const api = {
  identifySpeaker: (audio: string) =>
    req<{ speaker: string; score: number }>("/api/identify-speaker", jsonInit("POST", { audio })),
  enrollSpeaker: (name: string, samples: string[]) =>
    req<{ name: string; num_samples: number }>("/api/enroll-speaker", jsonInit("POST", { name, samples })),
  voiceProfiles: () => req<VoiceProfile[]>("/api/voice-profiles"),
  deleteProfile: (name: string) =>
    req<{ ok: boolean }>(`/api/voice-profiles/${encodeURIComponent(name)}`, { method: "DELETE" }),

  summarize: (transcript: string) =>
    req<{ summary: string }>("/api/summarize", jsonInit("POST", { transcript })),
  actionItems: (transcript: string) =>
    req<{ items: ActionItem[] }>("/api/action-items", jsonInit("POST", { transcript })),
  clean: (transcript: string) =>
    req<{ cleaned: string }>("/api/clean-transcript", jsonInit("POST", { transcript })),
  ask: (transcript: string, question: string) =>
    req<{ answer: string }>("/api/ask", jsonInit("POST", { transcript, question })),

  createMeeting: (title: string | null) =>
    req<{ id: string; title: string | null }>("/api/meetings", jsonInit("POST", { title })),
  listMeetings: () => req<MeetingRow[]>("/api/meetings"),
  getMeeting: (id: string) => req<MeetingDetail>(`/api/meetings/${id}`),
  appendEntries: (id: string, entries: EntryIn[]) =>
    req<{ added: number }>(`/api/meetings/${id}/entries`, jsonInit("POST", { entries })),
  updateMeeting: (id: string, body: { title?: string; summary?: string }) =>
    req<{ ok: boolean }>(`/api/meetings/${id}`, jsonInit("PUT", body)),
};
