/** Bottom floating control bar (presentational). */

import type { VideoDeviceInfo, VideoSourceKind } from "@assistants/core-web";
import type { CaptureTool } from "./CaptureCanvas";
import type { PromptTemplate } from "../lib/templates";

export interface ControlBarProps {
  source: VideoSourceKind;
  devices: VideoDeviceInfo[];
  selectedDevice: string;
  onSelectDevice: (id: string) => void;
  onStart: (kind: "camera" | "screen" | "device") => void;
  onStop: () => void;
  liveOn: boolean;
  liveStatus: string;
  onToggleLive: () => void;
  micOn: boolean;
  level: number;
  onToggleMic: () => void;
  audioOut: boolean;
  onToggleAudioOut: () => void;
  tool: CaptureTool;
  onTool: (t: CaptureTool) => void;
  onClearAnnotations: () => void;
  onOcr: () => void;
  templates: PromptTemplate[];
  onTemplate: (t: PromptTemplate) => void;
  onToggleSettings: () => void;
  busy: boolean;
}

export function ControlBar(props: ControlBarProps) {
  const hasFeed = props.source !== "none";
  return (
    <div className="control-bar">
      <div className="group">
        <button className="btn" onClick={() => props.onStart("camera")}>📷 Camera</button>
        <button className="btn" onClick={() => props.onStart("screen")}>🖥️ Screen</button>
        {props.devices.length > 0 && (
          <>
            <select
              className="btn"
              value={props.selectedDevice}
              onChange={(e) => props.onSelectDevice(e.target.value)}
            >
              <option value="">device…</option>
              {props.devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId.slice(0, 8)}
                </option>
              ))}
            </select>
            <button className="btn" disabled={!props.selectedDevice} onClick={() => props.onStart("device")}>
              Use
            </button>
          </>
        )}
        {hasFeed && <button className="btn" onClick={props.onStop}>⏹ Stop</button>}
      </div>

      <div className="sep" />

      <div className="group">
        <button
          className={`btn live ${props.liveOn ? "active" : ""}`}
          disabled={!hasFeed}
          onClick={props.onToggleLive}
          title={props.liveStatus}
        >
          {props.liveOn ? "● Live" : "⚡ Live"}
        </button>
        <button
          className={`btn ${props.micOn ? "active" : ""}`}
          disabled={!hasFeed}
          onClick={props.onToggleMic}
        >
          🎙️
        </button>
        <span className="level"><i style={{ width: `${Math.min(100, props.level * 200)}%` }} /></span>
        <button
          className={`btn ${props.audioOut ? "active" : ""}`}
          onClick={props.onToggleAudioOut}
          title="Play the model's spoken reply"
        >
          {props.audioOut ? "🔊" : "🔇"}
        </button>
      </div>

      <div className="sep" />

      <div className="group">
        <button
          className={`btn ${props.tool === "draw" ? "active" : ""}`}
          disabled={!hasFeed}
          onClick={() => props.onTool(props.tool === "draw" ? "none" : "draw")}
        >
          ✏️ Draw
        </button>
        <button
          className={`btn ${props.tool === "region" ? "active" : ""}`}
          disabled={!hasFeed}
          onClick={() => props.onTool(props.tool === "region" ? "none" : "region")}
        >
          ⬚ Region
        </button>
        <button className="btn" disabled={!hasFeed} onClick={props.onClearAnnotations}>Clear</button>
        <button className="btn" disabled={!hasFeed || props.busy} onClick={props.onOcr}>🔤 OCR</button>
      </div>

      <div className="sep" />

      <div className="group">
        <select
          className="btn"
          value=""
          disabled={!hasFeed}
          onChange={(e) => {
            const t = props.templates.find((x) => x.id === e.target.value);
            if (t) props.onTemplate(t);
            e.currentTarget.value = "";
          }}
        >
          <option value="">⌨ Templates…</option>
          {props.templates.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <button className="btn" onClick={props.onToggleSettings}>⚙</button>
      </div>
    </div>
  );
}
