import { useState } from "react";
import type { CSSProperties } from "react";
import { MarkdownRenderer } from "@assistants/core-web";
import { api } from "../lib/api";
import type { Application, TailorResult } from "../lib/types";

function downloadText(name: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ApplicationDetailProps {
  app: Application;
  statuses: string[];
  onChanged: () => void;
  onDeleted: () => void;
}

export function ApplicationDetail({ app, statuses, onChanged, onDeleted }: ApplicationDetailProps) {
  const [notes, setNotes] = useState(app.notes ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [tailor, setTailor] = useState<TailorResult | null>(null);
  const [cover, setCover] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (status: string) => void run("status", async () => { await api.updateApplication(app.id, { status }); onChanged(); });
  const saveNotes = () => void run("notes", async () => { await api.updateApplication(app.id, { notes }); onChanged(); });
  const del = () => { if (confirm("Delete this application?")) void run("del", async () => { await api.deleteApplication(app.id); onDeleted(); }); };
  const doTailor = () => void run("tailor", async () => setTailor(await api.tailor({ application_id: app.id })));
  const doCover = () => void run("cover", async () => setCover((await api.coverLetter({ application_id: app.id })).cover_letter));
  const doAsk = () => { if (question.trim()) void run("ask", async () => setAnswer((await api.answerQuestion({ application_id: app.id, question })).answer)); };

  const scoreClass = tailor ? (tailor.ats.score >= 80 ? "good" : tailor.ats.score >= 60 ? "warn" : "bad") : "";

  return (
    <div className="detail">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2>{app.title || "(untitled)"}</h2>
          <div className="hint">
            {app.company}{" "}
            {app.url && <a href={app.url} target="_blank" rel="noreferrer">↗</a>}
          </div>
        </div>
        <button className="btn" onClick={del}>Delete</button>
      </div>

      <div className="row" style={{ margin: "10px 0" }}>
        <select className="btn" value={app.status} onChange={(e) => setStatus(e.target.value)}>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="hint">{app.status_history.length} status change(s)</span>
      </div>

      <label className="field">
        Notes
        <textarea style={{ minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
      </label>

      {app.jd_text && (
        <details>
          <summary>Job description</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>{app.jd_text}</pre>
        </details>
      )}

      <div className="row" style={{ margin: "10px 0" }}>
        <button className="btn primary" disabled={busy !== null} onClick={doTailor}>
          {busy === "tailor" ? "Tailoring…" : "Tailor resume"}
        </button>
        <button className="btn" disabled={busy !== null} onClick={doCover}>
          {busy === "cover" ? "Writing…" : "Cover letter"}
        </button>
      </div>

      {tailor && (
        <div className="result">
          <div className="ats">
            <div
              className={`ats-gauge ${scoreClass}`}
              style={{ "--pct": tailor.ats.score } as CSSProperties}
            >
              <span className={`score mono ${scoreClass}`}>{tailor.ats.score}</span>
            </div>
            <div className="hint">ATS match · {tailor.iterations} iteration(s)</div>
            <div className="spacer" />
            <button className="btn" onClick={() => downloadText("resume.md", tailor.resume_markdown)}>Download .md</button>
          </div>
          {tailor.ats.missing.length > 0 && (
            <div className="hint" style={{ marginBottom: 6 }}>
              Still missing: {tailor.ats.missing.map((m, i) => <span className="chip" key={i}>{m}</span>)}
            </div>
          )}
          <MarkdownRenderer content={tailor.resume_markdown} />
        </div>
      )}

      {cover && (
        <div className="result">
          <b>Cover letter</b>
          <MarkdownRenderer content={cover} />
        </div>
      )}

      <div className="result">
        <b>Application Q&A</b>
        <div className="row" style={{ marginTop: 6 }}>
          <input
            className="text"
            style={{ flex: 1 }}
            placeholder="e.g. Why do you want this role?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doAsk(); }}
          />
          <button className="btn" disabled={busy !== null} onClick={doAsk}>Answer</button>
        </div>
        {answer && <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{answer}</div>}
      </div>
    </div>
  );
}
