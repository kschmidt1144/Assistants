/** Transparent overlay sized to the displayed feed: freehand annotations + drag-to-select region. */

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { contentRect, type Rect } from "../lib/capture";

export type CaptureTool = "none" | "draw" | "region";

export interface CaptureCanvasHandle {
  getCanvas: () => HTMLCanvasElement | null;
  getContentSize: () => { w: number; h: number };
  clear: () => void;
}

export interface CaptureCanvasProps {
  videoW: number;
  videoH: number;
  boxW: number;
  boxH: number;
  tool: CaptureTool;
  onRegion?: (rect: Rect) => void;
  /**
   * The displayed feed rectangle to align to. When provided it is the source of
   * truth (matches the natively-sized, never-upscaled `.feed-video`); otherwise
   * we fall back to the plain object-fit-contain math.
   */
  rect?: Rect;
}

export const CaptureCanvas = forwardRef<CaptureCanvasHandle, CaptureCanvasProps>(
  function CaptureCanvas({ videoW, videoH, boxW, boxH, tool, onRegion, rect: rectProp }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawing = useRef(false);
    const regionStart = useRef<{ x: number; y: number } | null>(null);
    const [regionBox, setRegionBox] = useState<Rect | null>(null);

    const rect = rectProp ?? contentRect(videoW, videoH, boxW, boxH);
    const cw = Math.max(1, Math.round(rect.w));
    const ch = Math.max(1, Math.round(rect.h));

    useImperativeHandle(
      ref,
      () => ({
        getCanvas: () => canvasRef.current,
        getContentSize: () => ({ w: cw, h: ch }),
        clear: () => {
          const c = canvasRef.current;
          const ctx = c?.getContext("2d");
          if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
        },
      }),
      [cw, ch],
    );

    function point(e: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } {
      const b = e.currentTarget.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    }

    function onDown(e: ReactPointerEvent<HTMLDivElement>) {
      if (tool === "none") return;
      const p = point(e);
      e.currentTarget.setPointerCapture(e.pointerId);
      if (tool === "draw") {
        drawing.current = true;
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) {
          ctx.strokeStyle = "#ff5c8a";
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }
      } else {
        regionStart.current = p;
        setRegionBox({ x: p.x, y: p.y, w: 0, h: 0 });
      }
    }

    function onMove(e: ReactPointerEvent<HTMLDivElement>) {
      if (tool === "draw" && drawing.current) {
        const p = point(e);
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) {
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
      } else if (tool === "region" && regionStart.current) {
        const p = point(e);
        const s = regionStart.current;
        setRegionBox({
          x: Math.min(s.x, p.x),
          y: Math.min(s.y, p.y),
          w: Math.abs(p.x - s.x),
          h: Math.abs(p.y - s.y),
        });
      }
    }

    function onUp(e: ReactPointerEvent<HTMLDivElement>) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (tool === "draw") {
        drawing.current = false;
      } else if (tool === "region") {
        if (regionBox && regionBox.w >= 4 && regionBox.h >= 4) onRegion?.(regionBox);
        regionStart.current = null;
        setRegionBox(null);
      }
    }

    return (
      <div
        style={{
          position: "fixed",
          left: rect.x,
          top: rect.y,
          width: cw,
          height: ch,
          zIndex: 50,
          pointerEvents: tool === "none" ? "none" : "auto",
          cursor: tool === "none" ? "default" : "crosshair",
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <canvas ref={canvasRef} width={cw} height={ch} style={{ position: "absolute", inset: 0, width: cw, height: ch }} />
        {regionBox && (
          <div
            className="region-box"
            style={{ left: regionBox.x, top: regionBox.y, width: regionBox.w, height: regionBox.h }}
          />
        )}
      </div>
    );
  },
);
