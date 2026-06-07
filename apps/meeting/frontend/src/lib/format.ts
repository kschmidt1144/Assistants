export interface Entry {
  ts: number; // epoch seconds
  speaker: string;
  text: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Wall-clock HH:MM:SS for a transcript timestamp. */
export function clockOf(ts: number): string {
  const d = new Date(ts * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** mm:ss elapsed for the meeting timer. */
export function elapsed(seconds: number): string {
  return `${pad(Math.floor(seconds / 60))}:${pad(Math.floor(seconds % 60))}`;
}

export function entriesToText(entries: Entry[]): string {
  return entries.map((e) => `[${clockOf(e.ts)}] ${e.speaker}: ${e.text}`).join("\n");
}

export function download(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
