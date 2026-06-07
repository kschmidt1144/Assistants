/** In-page draggable + resizable glass window (the "overlay" — no desktop shell, per decision #4). */

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

export interface DraggableWindowProps {
  title: string;
  children: ReactNode;
  initialX?: number;
  initialY?: number;
  width?: number;
  height?: number;
  onClose?: () => void;
}

export function DraggableWindow({
  title,
  children,
  initialX = 24,
  initialY = 24,
  width = 360,
  height = 280,
  onClose,
}: DraggableWindowProps) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [collapsed, setCollapsed] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const frame: CSSProperties = {
    position: "fixed",
    left: pos.x,
    top: pos.y,
    width,
    background: "rgba(20, 22, 30, 0.72)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
    color: "#e8eaf0",
    fontFamily: "Inter, system-ui, sans-serif",
    overflow: "hidden",
    zIndex: 1000,
  };
  const header: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "8px 12px",
    cursor: "grab",
    background: "rgba(255,255,255,0.04)",
    userSelect: "none",
    fontSize: 13,
    fontWeight: 600,
  };
  const body: CSSProperties = {
    height,
    padding: 12,
    overflow: "auto",
    resize: "both",
    display: collapsed ? "none" : "block",
  };
  const btn: CSSProperties = {
    background: "transparent",
    border: "none",
    color: "inherit",
    cursor: "pointer",
    opacity: 0.7,
    fontSize: 13,
    padding: "0 4px",
  };

  return (
    <div style={frame}>
      <div
        style={header}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span>{title}</span>
        <span>
          <button type="button" style={btn} onClick={() => setCollapsed((c) => !c)} aria-label="collapse">
            {collapsed ? "▢" : "—"}
          </button>
          {onClose && (
            <button type="button" style={btn} onClick={onClose} aria-label="close">
              ✕
            </button>
          )}
        </span>
      </div>
      <div style={body}>{children}</div>
    </div>
  );
}
