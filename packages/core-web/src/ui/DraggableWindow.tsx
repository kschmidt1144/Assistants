/**
 * DraggableWindow — backwards-compatible shim over {@link HudWindow}.
 *
 * The overlay panel grew up into HudWindow (move/resize/opacity/persist/z-order).
 * This thin wrapper preserves the old prop surface (`initialX`/`initialY`,
 * `width`/`height`) so existing call sites keep compiling; new code should import
 * `HudWindow` directly for the full feature set.
 */

import { HudWindow } from "./HudWindow";
import type { ReactNode } from "react";

export interface DraggableWindowProps {
  title: string;
  children: ReactNode;
  /** Persistence key — derived from the title when omitted. */
  id?: string;
  initialX?: number;
  initialY?: number;
  width?: number;
  height?: number;
  defaultOpacity?: number;
  onClose?: () => void;
}

export function DraggableWindow({
  title,
  children,
  id,
  initialX = 24,
  initialY = 24,
  width = 360,
  height = 280,
  defaultOpacity,
  onClose,
}: DraggableWindowProps) {
  return (
    <HudWindow
      id={id ?? `legacy.${title.replace(/\s+/g, "-").toLowerCase()}`}
      title={title}
      defaultPos={{ x: initialX, y: initialY }}
      defaultSize={{ w: width, h: height }}
      defaultOpacity={defaultOpacity}
      onClose={onClose}
    >
      {children}
    </HudWindow>
  );
}
