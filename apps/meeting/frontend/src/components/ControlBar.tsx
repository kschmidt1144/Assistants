import type { MeetingRow } from "../lib/api";

export interface ControlBarProps {
  speechSupported: boolean;
  live: boolean;
  onToggleLive: () => void;
  sysAudio: boolean;
  onToggleSysAudio: () => void;
  level: number;
  topic: string;
  setTopic: (v: string) => void;
  elapsedStr: string;
  saving: boolean;
  onSave: () => void;
  onExport: () => void;
  meetings: MeetingRow[];
  onLoad: (id: string) => void;
  onOpenProfiles: () => void;
}

export function ControlBar(props: ControlBarProps) {
  return (
    <div className="topbar">
      <span className="title">🎙️ Meeting Copilot</span>
      <button
        className={`btn rec ${props.live ? "active" : ""}`}
        disabled={!props.speechSupported}
        onClick={props.onToggleLive}
        title={props.speechSupported ? "" : "Web Speech API not supported — use Chrome"}
      >
        {props.live ? "● Recording" : "▶ Record"}
      </button>
      <button className={`btn ${props.sysAudio ? "active" : ""}`} onClick={props.onToggleSysAudio} title="Mix system/tab audio into speaker-ID">
        🔊 Sys
      </button>
      <span className="level"><i style={{ width: `${Math.min(100, props.level * 200)}%` }} /></span>

      <input className="topic" value={props.topic} placeholder="Meeting topic…" onChange={(e) => props.setTopic(e.target.value)} />
      <span className="timer">{props.elapsedStr}</span>

      <div className="spacer" />

      <select className="btn" value="" onChange={(e) => { if (e.target.value) props.onLoad(e.target.value); e.currentTarget.value = ""; }}>
        <option value="">History…</option>
        {props.meetings.map((m) => (
          <option key={m.id} value={m.id}>{m.title || m.id.slice(0, 8)}</option>
        ))}
      </select>
      <button className="btn" disabled={props.saving} onClick={props.onSave}>{props.saving ? "Saving…" : "Save"}</button>
      <button className="btn" onClick={props.onExport}>Export</button>
      <button className="btn" onClick={props.onOpenProfiles}>Profiles</button>
    </div>
  );
}
