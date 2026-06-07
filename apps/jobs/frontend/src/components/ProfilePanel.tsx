import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export function ProfilePanel() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void api
      .getProfile()
      .then((p) => setText(p.text))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    await api.setProfile(text);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const upload = async (f: File) => {
    try {
      const r = await api.uploadProfile(f);
      setText((await api.getProfile()).text);
      alert(`Loaded ${r.chars} characters from ${f.name}`);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="maxw">
      <h2>Master profile / resume</h2>
      <p className="hint">
        Your real experience — the AI tailors from this and never invents beyond it.
      </p>
      <label className="field">
        <textarea
          style={{ minHeight: 340 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your master resume / full experience here…"
        />
      </label>
      <div className="row">
        <button className="btn primary" onClick={() => void save()}>
          {saved ? "Saved ✓" : "Save"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.md"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Upload PDF/DOCX
        </button>
        <span className="hint">{loading ? "loading…" : `${text.length} chars`}</span>
      </div>
    </div>
  );
}
