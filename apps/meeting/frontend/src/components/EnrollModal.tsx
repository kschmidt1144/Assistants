import { useState } from "react";
import type { VoiceProfile } from "../lib/api";
import { recordClip } from "../lib/recorder";

export interface EnrollModalProps {
  profiles: VoiceProfile[];
  onClose: () => void;
  onEnroll: (name: string, samples: string[]) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}

export function EnrollModal({ profiles, onClose, onEnroll, onDelete }: EnrollModalProps) {
  const [name, setName] = useState("");
  const [samples, setSamples] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);

  const record = async () => {
    setRecording(true);
    try {
      const clip = await recordClip(); // ~2s
      setSamples((s) => [...s, clip]);
    } catch (e) {
      alert(`Mic error: ${(e as Error).message}`);
    } finally {
      setRecording(false);
    }
  };

  const save = async () => {
    if (!name.trim() || samples.length === 0) return;
    setSaving(true);
    try {
      await onEnroll(name.trim(), samples);
      setName("");
      setSamples([]);
    } catch (e) {
      alert(`Enroll failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Voice profiles</h3>

        <input value={name} placeholder="Speaker name" onChange={(e) => setName(e.target.value)} />
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn" disabled={recording} onClick={() => void record()}>
            {recording ? "Recording 2s…" : "Record sample"}
          </button>
          <span className="hint">{samples.length} sample(s)</span>
          <div className="spacer" />
          <button className="btn active" disabled={saving || !name.trim() || samples.length === 0} onClick={() => void save()}>
            Save profile
          </button>
        </div>

        <div style={{ maxHeight: 160, overflow: "auto" }}>
          {profiles.length === 0 && <div className="hint">No profiles yet.</div>}
          {profiles.map((p) => (
            <div className="profile-row" key={p.name}>
              <span>{p.name} <span className="hint">({p.num_samples})</span></span>
              <button className="btn" onClick={() => void onDelete(p.name)}>Delete</button>
            </div>
          ))}
        </div>

        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
