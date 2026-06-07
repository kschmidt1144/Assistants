import { useState } from "react";
import { api } from "../lib/api";
import type { ParsedJob } from "../lib/types";

export function AddJob({ onTracked }: { onTracked: () => void }) {
  const [jd, setJd] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [parsed, setParsed] = useState<ParsedJob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const parse = async () => {
    if (!jd.trim()) return;
    setBusy("parsing");
    try {
      const p = await api.parseJd(jd);
      setParsed(p);
      if (!title) setTitle(p.title);
      if (!company) setCompany(p.company);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const track = async () => {
    if (!jd.trim()) return;
    setBusy("saving");
    try {
      await api.createApplication({
        title: title || null,
        company: company || null,
        url: url || null,
        jd_text: jd,
        parsed_data: parsed,
      });
      setJd("");
      setTitle("");
      setCompany("");
      setUrl("");
      setParsed(null);
      onTracked();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="maxw">
      <h2>Add a job</h2>
      <p className="hint">Paste the job description (no scraping — paste the text). Optionally add a URL/title.</p>
      <div className="row" style={{ marginBottom: 8 }}>
        <input className="text" style={{ flex: 1 }} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="text" style={{ flex: 1 }} placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
      </div>
      <input className="text" style={{ marginBottom: 8 }} placeholder="URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <textarea style={{ minHeight: 220, marginBottom: 8 }} placeholder="Paste the job description…" value={jd} onChange={(e) => setJd(e.target.value)} />
      <div className="row">
        <button className="btn" disabled={busy !== null || !jd.trim()} onClick={() => void parse()}>
          {busy === "parsing" ? "Parsing…" : "Parse JD (AI)"}
        </button>
        <button className="btn primary" disabled={busy !== null || !jd.trim()} onClick={() => void track()}>
          {busy === "saving" ? "Saving…" : "Track"}
        </button>
      </div>
      {parsed && (
        <div className="result">
          <div className="row">
            <b>{parsed.title}</b>
            <span className="hint">· {parsed.seniority} · {parsed.work_type} · {parsed.employment_type}</span>
          </div>
          <div style={{ marginTop: 6 }}>
            <span className="hint">Required:</span> {parsed.required_skills.map((s, i) => <span className="chip" key={i}>{s}</span>)}
          </div>
          <div style={{ marginTop: 6 }}>
            <span className="hint">Preferred:</span> {parsed.preferred_skills.map((s, i) => <span className="chip" key={i}>{s}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
