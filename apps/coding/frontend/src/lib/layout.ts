/**
 * Anchored-layout geometry — where the feed sits and where the floating HUD
 * panels / control deck dock around it.
 *
 * The feed is pinned to the **top-left** at native 1:1 (never upscaled). On a
 * monitor larger than the feed (e.g. a 1080p passthrough on a 1440p panel) this
 * leaves a right-hand rail and a strip beneath the feed:
 *
 *     ┌──────────────┬──────┐
 *     │   feed 1:1   │ Live │   right rail  → Live (top) + Analysis (bottom)
 *     │  (top-left)  │ Anal │
 *     ├──────────────┤      │
 *     │  ‹ deck ›    │      │   strip under feed → control deck
 *     └──────────────┴──────┘
 *
 * Panels remain free-floating HudWindows; these are just their default homes
 * (and where "reset layout" snaps them back to).
 */

import type { Rect } from "./capture";

const GUTTER = 14; // breathing room between a panel and the viewport / feed edge
const MIN_PANEL_W = 300; // a chat panel narrower than this is uncomfortable
const MAX_RAIL_W = 760; // …and wider than this just wastes the rail
const MIN_PANEL_H = 200;
const LIVE_FRACTION = 0.42; // Live takes the top ~40% of the rail, Analysis the rest
const TITLEBAR_H = 44; // HudWindow chrome above the body — `h` (defaultSize) is body-only,
//                        so a stacked window occupies TITLEBAR_H + h vertically.

/**
 * The displayed feed rectangle: pinned **top-left**, `object-fit: contain`, but
 * never upscaled past native 1:1. This is the single source of truth the
 * `.feed-video` element and the annotation overlay both align to.
 */
export function feedRect(videoW: number, videoH: number, boxW: number, boxH: number): Rect {
  if (!videoW || !videoH) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / videoW, boxH / videoH, 1);
  return { x: 0, y: 0, w: videoW * scale, h: videoH * scale };
}

/** Width of the dead-space rail to the right of the feed. */
export function rightRailWidth(feed: Rect, boxW: number): number {
  return Math.max(0, boxW - (feed.x + feed.w));
}

/** True when the right rail is wide enough to dock a panel into. */
export function hasRightRail(feed: Rect, boxW: number): boolean {
  return rightRailWidth(feed, boxW) >= MIN_PANEL_W + GUTTER;
}

export interface DockSlots {
  live: Rect;
  analyze: Rect;
}

/**
 * Default homes for Live (top of the right rail) and Analysis (bottom). When
 * there's no rail (feed fills the width) we fall back to floating top corners
 * over the feed — the legacy behavior.
 */
export function dockSlots(feed: Rect, boxW: number, boxH: number): DockSlots {
  const rail = rightRailWidth(feed, boxW);

  if (rail < MIN_PANEL_W + GUTTER) {
    return {
      live: { x: GUTTER, y: GUTTER, w: 380, h: 360 },
      analyze: { x: Math.max(GUTTER, boxW - 400 - GUTTER), y: GUTTER, w: 400, h: 360 },
    };
  }

  const w = Math.round(Math.min(MAX_RAIL_W, rail - GUTTER * 2));
  const x = Math.round(feed.x + feed.w + (rail - w) / 2); // centered in the rail
  // Two stacked windows share the rail height; budget out 3 gutters + 2 titlebars,
  // then split the remaining *body* height (h is body-only, see TITLEBAR_H).
  const bodyBudget = boxH - GUTTER * 3 - TITLEBAR_H * 2;
  const liveH = Math.max(MIN_PANEL_H, Math.round(bodyBudget * LIVE_FRACTION));
  const analyzeH = Math.max(MIN_PANEL_H, bodyBudget - liveH);
  return {
    live: { x, y: GUTTER, w, h: liveH },
    analyze: { x, y: GUTTER + TITLEBAR_H + liveH + GUTTER, w, h: analyzeH },
  };
}

/**
 * Where the control deck sits: horizontally centered under the feed, vertically
 * centered in the strip beneath it. Returns the deck's center-x and top-y, or
 * `null` when there isn't enough room under the feed (deck keeps its bottom dock).
 */
export function deckHome(feed: Rect, _boxW: number, boxH: number): { cx: number; y: number } | null {
  const strip = boxH - (feed.y + feed.h);
  if (strip < 80) return null;
  const cx = Math.round(feed.x + feed.w / 2);
  const y = Math.round(feed.y + feed.h + Math.max(16, (strip - 64) / 2));
  return { cx, y };
}
