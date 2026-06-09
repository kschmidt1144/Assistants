import { describe, it, expect, vi } from "vitest";
import { recordClip } from "./recorder";
import { AudioWorkletCapture } from "@assistants/core-web";

vi.mock("@assistants/core-web", () => {
  return {
    AudioWorkletCapture: vi.fn().mockImplementation(function() {
      return { 
        start: vi.fn().mockImplementation(async function(opts: any) {
          // Immediately simulate audio chunk
          setTimeout(() => opts.onAudio("b64"), 0);
          return Promise.resolve();
        }),
        stop: vi.fn(),
      };
    })
  };
});

describe("recorder", () => {
  it("MTG-U-09: recordClip resolves base64 and stops", async () => {
    const p = recordClip(16000);
    const result = await p;
    expect(result).toBe("b64");
  });
});
