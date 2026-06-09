import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AudioPlayback } from "./AudioPlayback";

describe("AudioPlayback", () => {
  let mockAudioContext: any;
  let mockBufferSource: any;

  beforeEach(() => {
    mockBufferSource = {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
    };

    mockAudioContext = {
      currentTime: 10,
      createBuffer: vi.fn((channels, count, sampleRate) => {
        return {
          duration: count / sampleRate,
          getChannelData: vi.fn(() => new Float32Array(count)),
        };
      }),
      createBufferSource: vi.fn(() => mockBufferSource),
      destination: {},
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.stubGlobal("AudioContext", vi.fn().mockImplementation(function() { return mockAudioContext; }));
    vi.stubGlobal("atob", (str: string) => Buffer.from(str, "base64").toString("binary"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("WEB-U-05: handles b64->f32 decode and schedules gapless playback", () => {
    const playback = new AudioPlayback(24000);
    
    // b64 for 4 bytes: 00 00 00 00 (two samples) -> "AAAAAA=="
    playback.enqueue("AAAAAA==");
    
    expect(global.AudioContext).toHaveBeenCalled();
    expect(mockAudioContext.createBuffer).toHaveBeenCalledWith(1, 2, 24000);
    expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
    expect(mockBufferSource.connect).toHaveBeenCalledWith(mockAudioContext.destination);
    
    // First chunk scheduled at max(nextTime(10), currentTime(10)) = 10
    expect(mockBufferSource.start).toHaveBeenCalledWith(10);
    
    // Enqueue second chunk
    mockBufferSource.start.mockClear();
    mockAudioContext.currentTime = 10.00001; // slightly past but still waiting
    playback.enqueue("AAAAAA==");
    
    // Should be scheduled exactly at end of first chunk (10 + 2/24000)
    expect(mockBufferSource.start).toHaveBeenCalledWith(10 + 2 / 24000);
  });

  it("WEB-U-05: ignores <2 bytes", () => {
    const playback = new AudioPlayback(24000);
    // 1 byte base64 -> "AA=="
    playback.enqueue("AA==");
    
    // createBuffer is not called
    expect(mockAudioContext.createBuffer).not.toHaveBeenCalled();
  });
});
