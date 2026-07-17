/**
 * HudWindow — the in-page "overlay" panel for the Aperture HUD (no desktop
 * shell, per decision #4). A floating glass window that is:
 *   • movable   (drag the title bar; clamped so it can never be lost off-screen)
 *   • resizable (8 edge/corner handles, min/max + viewport clamped)
 *   • opacity-adjustable (per-window, so chat boxes can fade to read the screen behind)
 *   • focus-aware (click brings to front + glows; siblings recede)
 *   • collapsible, snap-to-edge, keyboard-operable
 *   • persistent (position/size/opacity/collapsed saved per `id` in localStorage)
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

export interface HudWindowState {
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  collapsed: boolean;
}

export type HudTone = "live" | "good" | "warn" | "bad" | "neutral";

export interface HudWindowProps {
  /** Stable persistence key, e.g. "coding.live". */
  id: string;
  title: ReactNode;
  children: ReactNode;
  /** Optional 16px glyph shown before the title. */
  icon?: ReactNode;
  /** Inline status pill in the title bar (e.g. live connection state). */
  statusPill?: { label: string; tone?: HudTone };
  /** Seed geometry — only used when nothing is persisted for this id. */
  defaultPos?: { x: number; y: number };
  defaultSize?: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  /**
   * Imperative re-placement signal. When {@link placeNonce} changes to a new
   * value the window snaps to `place` (viewport-clamped) and brings itself to
   * front — used by "tile to margins". Unlike {@link defaultPos}/{@link defaultSize}
   * (first-run only), this overrides the persisted/current geometry on demand.
   */
  place?: { x: number; y: number; w: number; h: number } | null;
  placeNonce?: number;
  /** 0.35..1, default 1 (coding overlay panels seed 0.85). */
  defaultOpacity?: number;
  resizable?: boolean;
  opacityControl?: boolean;
  collapsible?: boolean;
  snapToEdge?: boolean;
  /** App-specific buttons rendered left of the opacity/collapse/close controls. */
  headerActions?: ReactNode;
  className?: string;
  onClose?: () => void;
}

const TITLEBAR_H = 44;
const MIN_VISIBLE = 48; // px of the title bar that must always stay on-screen
const SNAP = 8; // viewport-edge snap threshold / inset
const STORE_PREFIX = "hud.win.";

// ── module-level focus + z-order coordination ────────────────────────────────
let zCounter = 10;
let focusedId: string | null = null;
const focusListeners = new Set<() => void>();
function setFocused(id: string): void {
  if (focusedId === id) return;
  focusedId = id;
  focusListeners.forEach((l) => l());
}

/** Clear persisted layout for windows whose id starts with `prefix` (default: all). */
export function resetHudLayout(prefix = ""): void {
  if (typeof localStorage === "undefined") return;
  const match = STORE_PREFIX + prefix;
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(match)) doomed.push(key);
  }
  doomed.forEach((k) => localStorage.removeItem(k));
}

// ── persistence helpers ───────────────────────────────────────────────────────
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function loadState(id: string, defaults: HudWindowState): HudWindowState {
  if (typeof localStorage === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(STORE_PREFIX + id);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<HudWindowState>;
    return {
      x: num(p.x, defaults.x),
      y: num(p.y, defaults.y),
      w: num(p.w, defaults.w),
      h: num(p.h, defaults.h),
      opacity: num(p.opacity, defaults.opacity),
      collapsed: typeof p.collapsed === "boolean" ? p.collapsed : defaults.collapsed,
    };
  } catch {
    return defaults;
  }
}

// ── geometry clamping ─────────────────────────────────────────────────────────
function viewport(): { vw: number; vh: number } {
  return { vw: window.innerWidth, vh: window.innerHeight };
}

function clampPos(x: number, y: number, w: number): { x: number; y: number } {
  const { vw, vh } = viewport();
  const cx = Math.min(vw - MIN_VISIBLE, Math.max(MIN_VISIBLE - w, x));
  const cy = Math.min(vh - TITLEBAR_H, Math.max(0, y));
  return { x: cx, y: cy };
}

function fitToViewport(s: HudWindowState, min: { w: number; h: number }): HudWindowState {
  const { vw, vh } = viewport();
  const w = Math.max(min.w, Math.min(s.w, Math.round(vw * 0.96)));
  const h = Math.max(min.h, Math.min(s.h, Math.round(vh * 0.92) - TITLEBAR_H));
  const { x, y } = clampPos(s.x, s.y, w);
  return { ...s, w, h, x, y };
}

// ── inline SVG glyphs (lucide-ish, stroke) ───────────────────────────────────
function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const ICON_DROPLET = "M12 3l5.2 6.6a6.6 6.6 0 1 1-10.4 0z";
const ICON_MINUS = "M6 12h12";
const ICON_X = "M6 6l12 12M18 6L6 18";

type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Dir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

interface Gesture {
  kind: "move" | Dir;
  px: number;
  py: number;
  ox: number;
  oy: number;
  ow: number;
  oh: number;
  alt: boolean;
}

export function HudWindow(props: HudWindowProps) {
  const {
    id,
    title,
    children,
    icon,
    statusPill,
    defaultPos = { x: 24, y: 24 },
    defaultSize = { w: 380, h: 320 },
    minSize = { w: 240, h: 140 },
    maxSize,
    place,
    placeNonce,
    defaultOpacity = 1,
    resizable = true,
    opacityControl = true,
    collapsible = true,
    snapToEdge = true,
    headerActions,
    className,
    onClose,
  } = props;

  const defaults: HudWindowState = {
    x: defaultPos.x,
    y: defaultPos.y,
    w: defaultSize.w,
    h: defaultSize.h,
    opacity: Math.min(1, Math.max(0.35, defaultOpacity)),
    collapsed: false,
  };

  const [state, setState] = useState<HudWindowState>(() =>
    fitToViewport(loadState(id, defaults), minSize),
  );
  const [z, setZ] = useState<number>(() => ++zCounter);
  const [dragging, setDragging] = useState(false);
  const [resizingDir, setResizingDir] = useState<Dir | null>(null);
  const [showOpacity, setShowOpacity] = useState(false);
  const [snapGuide, setSnapGuide] = useState<CSSProperties | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const gesture = useRef<Gesture | null>(null);
  const raf = useRef<number | null>(null);
  const pending = useRef<HudWindowState | null>(null);

  // ── focus / bring-to-front ──────────────────────────────────────────────────
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    focusListeners.add(force);
    return () => {
      focusListeners.delete(force);
    };
  }, []);
  const focused = focusedId === id;
  const bringToFront = useCallback(() => {
    setFocused(id);
    setZ(++zCounter);
  }, [id]);

  // ── persistence (debounced) ─────────────────────────────────────────────────
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE_PREFIX + id, JSON.stringify(stateRef.current));
      } catch {
        /* quota / private mode — non-fatal */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [id, state]);

  // ── re-clamp every open window when the viewport shrinks ─────────────────────
  useEffect(() => {
    const onResize = () => setState((s) => fitToViewport(s, minSize));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minSize]);

  // ── imperative re-placement (tile-to-margins) ────────────────────────────────
  // Snap to `place` whenever `placeNonce` advances. Seeded to the initial nonce so
  // a mount never re-places (mount uses persisted/default geometry); only a later
  // bump moves the window. Guarded so spurious re-renders can't re-fire it.
  const placeRef = useRef(place);
  placeRef.current = place;
  const appliedNonce = useRef(placeNonce);
  useEffect(() => {
    if (placeNonce === undefined || placeNonce === appliedNonce.current) return;
    appliedNonce.current = placeNonce;
    const p = placeRef.current;
    if (!p) return;
    bringToFront();
    setState((s) => fitToViewport({ ...s, x: p.x, y: p.y, w: p.w, h: p.h }, minSize));
  }, [placeNonce, minSize, bringToFront]);

  const commit = useCallback((next: HudWindowState) => {
    pending.current = next;
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      if (pending.current) setState(pending.current);
    });
  }, []);

  // ── pointer gesture engine (move + resize) ──────────────────────────────────
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.px;
      const dy = e.clientY - g.py;
      const { vw, vh } = viewport();
      const maxW = Math.max(minSize.w, maxSize?.w ?? Math.round(vw * 0.96));
      const maxH = Math.max(minSize.h, maxSize?.h ?? Math.round(vh * 0.92) - TITLEBAR_H);

      if (g.kind === "move") {
        let nx = g.ox + dx;
        let ny = g.oy + dy;
        const clamped = clampPos(nx, ny, g.ow);
        nx = clamped.x;
        ny = clamped.y;

        // snap-to-edge (suppressed while holding Alt)
        let guide: CSSProperties | null = null;
        if (snapToEdge && !e.altKey) {
          const frameH = TITLEBAR_H + (stateRef.current.collapsed ? 0 : g.oh);
          if (Math.abs(nx - SNAP) <= SNAP) {
            nx = SNAP;
            guide = { left: SNAP, top: 0, width: 2, height: "100vh" };
          } else if (Math.abs(vw - (nx + g.ow) - SNAP) <= SNAP) {
            nx = vw - g.ow - SNAP;
            guide = { left: vw - SNAP - 2, top: 0, width: 2, height: "100vh" };
          }
          if (Math.abs(ny - SNAP) <= SNAP) {
            ny = SNAP;
            guide = { left: 0, top: SNAP, width: "100vw", height: 2 };
          } else if (Math.abs(vh - (ny + frameH) - SNAP) <= SNAP) {
            ny = vh - frameH - SNAP;
            guide = { left: 0, top: vh - SNAP - 2, width: "100vw", height: 2 };
          }
        }
        setSnapGuide(guide);
        commit({ ...stateRef.current, x: nx, y: ny });
        return;
      }

      // resize
      const dir = g.kind;
      let { ox: nx, oy: ny, ow: nw, oh: nh } = g;
      if (dir.includes("e")) nw = g.ow + dx;
      if (dir.includes("s")) nh = g.oh + dy;
      if (dir.includes("w")) {
        nw = g.ow - dx;
        nw = Math.min(maxW, Math.max(minSize.w, nw));
        nx = g.ox + g.ow - nw;
      }
      if (dir.includes("n")) {
        nh = g.oh - dy;
        nh = Math.min(maxH, Math.max(minSize.h, nh));
        ny = g.oy + g.oh - nh;
      }
      nw = Math.min(maxW, Math.max(minSize.w, nw));
      nh = Math.min(maxH, Math.max(minSize.h, nh));
      // keep inside the viewport when growing toward the right / bottom edge
      if (dir.includes("e")) nw = Math.min(nw, vw - nx - 4);
      if (dir.includes("s")) nh = Math.min(nh, vh - ny - TITLEBAR_H - 4);
      nw = Math.max(minSize.w, nw);
      nh = Math.max(minSize.h, nh);
      commit({ ...stateRef.current, x: Math.max(0, nx), y: Math.max(0, ny), w: nw, h: nh });
    },
    [commit, maxSize, minSize.h, minSize.w, snapToEdge],
  );

  const endGesture = useCallback(() => {
    gesture.current = null;
    setDragging(false);
    setResizingDir(null);
    setSnapGuide(null);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", endGesture);
  }, [onPointerMove]);

  const startGesture = useCallback(
    (kind: Gesture["kind"], e: ReactPointerEvent) => {
      e.preventDefault();
      bringToFront();
      const s = stateRef.current;
      gesture.current = { kind, px: e.clientX, py: e.clientY, ox: s.x, oy: s.y, ow: s.w, oh: s.h, alt: e.altKey };
      if (kind === "move") setDragging(true);
      else setResizingDir(kind);
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", endGesture);
    },
    [bringToFront, endGesture, onPointerMove],
  );

  useEffect(() => () => endGesture(), [endGesture]);

  // ── control actions ─────────────────────────────────────────────────────────
  const setOpacity = useCallback((o: number) => {
    setState((s) => ({ ...s, opacity: Math.min(1, Math.max(0.35, Number(o.toFixed(2)))) }));
  }, []);
  const nudgeOpacity = useCallback(
    (delta: number) => setState((s) => ({ ...s, opacity: Math.min(1, Math.max(0.35, Number((s.opacity + delta).toFixed(2)))) })),
    [],
  );
  const toggleCollapse = useCallback(() => setState((s) => ({ ...s, collapsed: !s.collapsed })), []);

  // ── keyboard control (title bar focused) ─────────────────────────────────────
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const big = e.shiftKey ? 10 : 1;
      const resize = e.ctrlKey || e.metaKey;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          setState((s) => (resize ? { ...s, w: Math.max(minSize.w, s.w - 10) } : { ...s, ...clampPos(s.x - big, s.y, s.w) }));
          break;
        case "ArrowRight":
          e.preventDefault();
          setState((s) => (resize ? { ...s, w: s.w + 10 } : { ...s, ...clampPos(s.x + big, s.y, s.w) }));
          break;
        case "ArrowUp":
          e.preventDefault();
          setState((s) => (resize ? { ...s, h: Math.max(minSize.h, s.h - 10) } : { ...s, ...clampPos(s.x, s.y - big, s.w) }));
          break;
        case "ArrowDown":
          e.preventDefault();
          setState((s) => (resize ? { ...s, h: s.h + 10 } : { ...s, ...clampPos(s.x, s.y + big, s.w) }));
          break;
        case "[":
          nudgeOpacity(-0.05);
          break;
        case "]":
          nudgeOpacity(0.05);
          break;
        case ".":
          if (resize && collapsible) {
            e.preventDefault();
            toggleCollapse();
          }
          break;
        case "Escape":
          if (onClose) onClose();
          break;
        default:
          break;
      }
    },
    [collapsible, minSize.h, minSize.w, nudgeOpacity, onClose, toggleCollapse],
  );

  // ── render ────────────────────────────────────────────────────────────────--
  const ariaLabel = typeof title === "string" ? title : id;
  const bodyH = state.collapsed ? 0 : state.h;
  const frameStyle: CSSProperties & Record<string, string | number> = {
    left: Math.round(state.x),
    top: Math.round(state.y),
    width: Math.round(state.w),
    zIndex: 1000 + z,
    "--win-opacity": String(state.opacity),
  };

  return (
    <>
      {snapGuide && <div className="hud-snap-guide" style={snapGuide} aria-hidden />}
      <section
        className={`hud-window${dragging ? " dragging" : ""}${resizingDir ? " resizing" : ""}${className ? ` ${className}` : ""}`}
        style={frameStyle}
        data-focused={focused}
        data-collapsed={state.collapsed}
        role="region"
        aria-label={ariaLabel}
        onPointerDownCapture={bringToFront}
      >
        <span className="hud-spine" aria-hidden />

        <header
          className="hud-window-titlebar"
          tabIndex={0}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button,input")) return; // let controls work
            startGesture("move", e);
          }}
          onKeyDown={onKeyDown}
        >
          <span className="hud-grip" aria-hidden />
          {icon && <span className="hud-icon" aria-hidden>{icon}</span>}
          <span className="hud-window-title">{title}</span>
          {statusPill && (
            <span className={`pill ${statusPill.tone ?? "neutral"}`}>{statusPill.label}</span>
          )}
          <span className="spacer" />
          <span className="hud-titlebar-actions">
            {headerActions}
            {opacityControl && (
              <button
                type="button"
                className={`hud-icon-btn${showOpacity ? " active" : ""}`}
                aria-label="opacity"
                title="Opacity"
                onClick={() => setShowOpacity((v) => !v)}
                onWheel={(e) => nudgeOpacity(e.deltaY < 0 ? 0.05 : -0.05)}
              >
                <Glyph d={ICON_DROPLET} />
              </button>
            )}
            {collapsible && (
              <button type="button" className="hud-icon-btn" aria-label="collapse" title="Collapse" onClick={toggleCollapse}>
                <Glyph d={ICON_MINUS} />
              </button>
            )}
            {onClose && (
              <button type="button" className="hud-icon-btn" aria-label="close" title="Close" onClick={onClose}>
                <Glyph d={ICON_X} />
              </button>
            )}
          </span>
        </header>

        {showOpacity && opacityControl && (
          <div className="hud-opacity-pop" role="group" aria-label="opacity">
            <input
              type="range"
              className="hud-range"
              min={0.35}
              max={1}
              step={0.01}
              value={state.opacity}
              aria-label="window opacity"
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
            <span className="readout mono">{Math.round(state.opacity * 100)}%</span>
          </div>
        )}

        <div
          className="hud-window-body"
          style={{ height: bodyH, overflow: state.collapsed ? "hidden" : "auto" }}
          aria-hidden={state.collapsed}
        >
          {children}
        </div>

        {resizable &&
          !state.collapsed &&
          HANDLES.map((d) => (
            <div
              key={d}
              className={`hud-rh hud-rh-${d}`}
              aria-hidden
              onPointerDown={(e) => startGesture(d, e)}
            />
          ))}
      </section>
    </>
  );
}
