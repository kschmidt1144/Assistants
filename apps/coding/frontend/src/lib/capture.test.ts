import { describe, it, expect } from "vitest";
import { contentRect } from "./capture";

describe("capture", () => {
  it("COD-U-09: contentRect object-fit-contain math", () => {
    // 16:9 video in 4:3 box (box is narrower relative to height)
    // video = 1920x1080 (1.77), box = 800x600 (1.33)
    // scale = min(800/1920, 600/1080) = min(0.416, 0.555) = 0.41666...
    // w = 800, h = 450
    // y = (600 - 450) / 2 = 75
    let rect = contentRect(1920, 1080, 800, 600);
    expect(rect.w).toBe(800);
    expect(rect.h).toBe(450);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(75);

    // 4:3 video in 16:9 box (box is wider relative to height)
    // video = 800x600, box = 1920x1080
    // scale = min(1920/800, 1080/600) = min(2.4, 1.8) = 1.8
    // w = 800*1.8 = 1440, h = 1080
    // x = (1920 - 1440) / 2 = 240
    rect = contentRect(800, 600, 1920, 1080);
    expect(rect.w).toBe(1440);
    expect(rect.h).toBe(1080);
    expect(rect.x).toBe(240);
    expect(rect.y).toBe(0);

    // zero dims
    rect = contentRect(0, 0, 100, 100);
    expect(rect.w).toBe(100);
    expect(rect.h).toBe(100);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });
});
