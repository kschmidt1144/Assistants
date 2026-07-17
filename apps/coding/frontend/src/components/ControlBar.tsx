/** Floating "command deck" — the coding HUD control bar (presentational + draggable). */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { VideoDeviceInfo, VideoSourceKind } from "@assistants/core-web";
import type { CaptureTool } from "./CaptureCanvas";

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
  onAnalyze: () => void;
  onOcr: () => void;
  onOpenActions: () => void;
  onToggleSettings: () => void;
  busy: boolean;
  /** Default home (center-x / top-y) when the user hasn't dragged the deck — under the feed. */
  homePos?: { cx: number; y: number } | null;
  /** Bump to snap the deck back to {@link homePos} (used by "reset layout"). */
  placeNonce?: number;
}

const BAR_KEY = "hud.bar.coding";

/** Lets the user drag the whole deck anywhere (default: docked bottom-center). */
function useDeckPosition() {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(BAR_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x?: number; y?: number };
        if (typeof p.x === "number" && typeof p.y === "number") return { x: p.x, y: p.y };
      }
    } catch {
      /* ignore */
    }
    return null;
  });

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const x = Math.min(window.innerWidth - 48, Math.max(48 - w, d.ox + (e.clientX - d.px)));
    const y = Math.min(window.innerHeight - h, Math.max(0, d.oy + (e.clientY - d.py)));
    setPos({ x, y });
  }, []);

  const onUp = useCallback(() => {
    drag.current = null;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    setPos((p) => {
      if (p) {
        try {
          localStorage.setItem(BAR_KEY, JSON.stringify(p));
        } catch {
          /* ignore */
        }
      }
      return p;
    });
  }, [onMove]);

  const startDrag = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const rect = ref.current?.getBoundingClientRect();
      drag.current = {
        px: e.clientX,
        py: e.clientY,
        ox: pos?.x ?? rect?.left ?? 0,
        oy: pos?.y ?? rect?.top ?? 0,
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [onMove, onUp, pos],
  );

  const reset = useCallback(() => {
    setPos(null);
    try {
      localStorage.removeItem(BAR_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(
    () => () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    },
    [onMove, onUp],
  );

  return { pos, ref, startDrag, reset };
}

/** 7-segment broadcast-style input meter with a short peak-hold. */
function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const lit = active ? Math.min(7, Math.round(level * 14)) : 0;
  const [peak, setPeak] = useState(0);
  useEffect(() => {
    setPeak((p) => (lit > p ? lit : p));
  }, [lit]);
  useEffect(() => {
    if (peak <= 0) return;
    const t = window.setTimeout(() => setPeak((p) => Math.max(0, p - 1)), 90);
    return () => clearTimeout(t);
  }, [peak]);

  return (
    <span className={`hud-meter ${active ? "" : "off"}`} aria-hidden>
      {Array.from({ length: 7 }, (_, i) => {
        const on = active && i < lit;
        const hold = active && !on && i === peak - 1;
        const cls = [
          "seg",
          on ? "on" : "",
          (on || hold) && i >= 4 && i < 6 ? "warn" : "",
          (on || hold) && i === 6 ? "peak" : "",
          hold ? "on hold" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return <span key={i} className={cls} />;
      })}
    </span>
  );
}

export function ControlBar(props: ControlBarProps) {
  const hasFeed = props.source !== "none";
  const { pos, ref, startDrag, reset } = useDeckPosition();
  const { placeNonce, homePos } = props;

  // Snap back to the home position under the feed when "reset layout" fires.
  const appliedNonce = useRef(placeNonce);
  useEffect(() => {
    if (placeNonce === undefined || placeNonce === appliedNonce.current) return;
    appliedNonce.current = placeNonce;
    reset();
  }, [placeNonce, reset]);

  const tone = props.liveStatus.startsWith("error")
    ? "bad"
    : props.liveStatus === "connecting"
      ? "warn"
      : props.liveOn || props.liveStatus === "connected" || props.liveStatus === "streaming"
        ? "live"
        : "neutral";

  // Resting deck position: user-dragged (pos) → centered under the feed (homePos) → CSS bottom dock.
  const style = pos
    ? { left: pos.x, top: pos.y, bottom: "auto", transform: "none" as const }
    : homePos
      ? { left: homePos.cx, top: homePos.y, bottom: "auto", transform: "translateX(-50%)" as const }
      : undefined;

  return (
    <div
      ref={ref}
      className={`control-bar${pos ? " floating" : ""}`}
      style={style}
    >
      <button
        type="button"
        className="deck-grip"
        aria-label="Move toolbar"
        title="Drag to move · double-click to reset"
        onPointerDown={startDrag}
        onDoubleClick={reset}
      />

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

      <div className="group live-cluster">
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
          aria-label="Toggle microphone"
        >
          🎙️
        </button>
        <LevelMeter level={props.level} active={props.micOn} />
        <button
          className={`btn ${props.audioOut ? "active" : ""}`}
          onClick={props.onToggleAudioOut}
          title="Play the model's spoken reply"
        >
          {props.audioOut ? "🔊" : "🔇"}
        </button>
        {hasFeed && <span className={`pill ${tone}`}>{props.liveStatus}</span>}
      </div>

      <div className="sep" />

      <div className="group">
        <button
          className="btn"
          disabled={!hasFeed || props.busy}
          onClick={props.onAnalyze}
          title="Analyze the whole screen (A)"
        >
          🔬 Analyze
        </button>
        <button
          className={`btn ${props.tool === "region" ? "active" : ""}`}
          disabled={!hasFeed}
          onClick={() => props.onTool(props.tool === "region" ? "none" : "region")}
          title="Select a region to analyze (R)"
        >
          ⬚ Region
        </button>
        <button className="btn" disabled={!hasFeed || props.busy} onClick={props.onOcr} title="Extract text (O)">🔤 OCR</button>
        <button
          className={`btn ${props.tool === "draw" ? "active" : ""}`}
          disabled={!hasFeed}
          onClick={() => props.onTool(props.tool === "draw" ? "none" : "draw")}
          title="Draw annotations"
        >
          ✏️ Draw
        </button>
        <button className="btn" disabled={!hasFeed} onClick={props.onClearAnnotations} title="Clear annotations">Clear</button>
      </div>

      <div className="sep" />

      <div className="group">
        <button className="btn" onClick={props.onOpenActions} aria-label="Quick actions" title="Quick actions (⌘K)">
          ⚡ Actions <kbd className="deck-kbd">⌘K</kbd>
        </button>
        <button className="btn" onClick={props.onToggleSettings} aria-label="Settings">⚙</button>
      </div>
    </div>
  );
}
