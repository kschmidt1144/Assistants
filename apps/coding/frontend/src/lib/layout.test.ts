import { describe, it, expect } from "vitest";
import { feedRect, rightRailWidth, hasRightRail, dockSlots, deckHome } from "./layout";

describe("layout", () => {
  describe("feedRect", () => {
    it("pins a smaller feed to the top-left at native 1:1 (never upscales)", () => {
      // 1080p feed on a 1440p panel → native, anchored top-left.
      const r = feedRect(1920, 1080, 2560, 1440);
      expect(r).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    });

    it("downscales a feed larger than the viewport (object-fit contain)", () => {
      const r = feedRect(3840, 2160, 2560, 1440);
      expect(r).toEqual({ x: 0, y: 0, w: 2560, h: 1440 });
    });

    it("fills exactly when feed matches the viewport", () => {
      expect(feedRect(2560, 1440, 2560, 1440)).toEqual({ x: 0, y: 0, w: 2560, h: 1440 });
    });

    it("falls back to the full box for unknown dims", () => {
      expect(feedRect(0, 0, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    });
  });

  describe("right rail detection", () => {
    it("reports rail width and availability for a 1080p feed on 1440p", () => {
      const feed = feedRect(1920, 1080, 2560, 1440);
      expect(rightRailWidth(feed, 2560)).toBe(640);
      expect(hasRightRail(feed, 2560)).toBe(true);
    });

    it("has no rail when the feed fills the width", () => {
      const feed = feedRect(2560, 1440, 2560, 1440);
      expect(rightRailWidth(feed, 2560)).toBe(0);
      expect(hasRightRail(feed, 2560)).toBe(false);
    });
  });

  describe("dockSlots", () => {
    it("stacks Live over Analysis in the right rail, both clear of the feed", () => {
      const vw = 2560;
      const vh = 1440;
      const feed = feedRect(1920, 1080, vw, vh); // {0,0,1920,1080}
      const { live, analyze } = dockSlots(feed, vw, vh);

      // Both sit entirely in the right rail (never over the feed) and inside the viewport.
      for (const p of [live, analyze]) {
        expect(p.x).toBeGreaterThanOrEqual(feed.x + feed.w);
        expect(p.x + p.w).toBeLessThanOrEqual(vw);
      }
      // Same column, Live above Analysis. `h` is body-only; each window also has a
      // 44px titlebar, so Analysis must start below Live's *full* window…
      const TITLEBAR = 44;
      expect(live.x).toBe(analyze.x);
      expect(live.w).toBe(analyze.w);
      expect(live.y).toBeLessThan(analyze.y);
      expect(analyze.y).toBeGreaterThanOrEqual(live.y + TITLEBAR + live.h);
      // …and Analysis's full window (titlebar + body) stays on screen.
      expect(analyze.y + TITLEBAR + analyze.h).toBeLessThanOrEqual(vh);
    });

    it("falls back to opposite top corners when the feed fills the viewport", () => {
      const vw = 2560;
      const vh = 1440;
      const feed = feedRect(2560, 1440, vw, vh);
      const { live, analyze } = dockSlots(feed, vw, vh);
      expect(live.x).toBeLessThan(vw / 2);
      expect(analyze.x).toBeGreaterThan(vw / 2);
      expect(analyze.x + analyze.w).toBeLessThanOrEqual(vw);
    });
  });

  describe("deckHome", () => {
    it("centers the deck horizontally under the feed, within the strip below it", () => {
      const feed = feedRect(1920, 1080, 2560, 1440);
      const home = deckHome(feed, 2560, 1440);
      expect(home).not.toBeNull();
      expect(home!.cx).toBe(960); // feed.x + feed.w / 2
      expect(home!.y).toBeGreaterThanOrEqual(feed.y + feed.h); // below the feed
      expect(home!.y).toBeLessThan(1440); // …but on screen
    });

    it("returns null when the feed leaves no strip beneath it", () => {
      const feed = feedRect(2560, 1440, 2560, 1440);
      expect(deckHome(feed, 2560, 1440)).toBeNull();
    });
  });
});
