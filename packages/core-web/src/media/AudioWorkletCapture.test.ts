import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AudioWorkletCapture } from "./AudioWorkletCapture";

describe("AudioWorkletCapture", () => {
  let mockAudioContext: any;
  let mockAudioWorkletNode: any;
  let mockMediaStreamSource: any;

  beforeEach(() => {
    mockMediaStreamSource = {
      connect: vi.fn().mockReturnThis(),
    };

    mockAudioContext = {
      audioWorklet: {
        addModule: vi.fn().mockResolvedValue(undefined),
      },
      createMediaStreamSource: vi.fn(() => mockMediaStreamSource),
      createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn().mockReturnThis() })),
      destination: {},
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockAudioWorkletNode = {
      port: {
        onmessage: null,
        close: vi.fn(),
      },
      connect: vi.fn().mockReturnThis(),
      disconnect: vi.fn(),
    };

    vi.stubGlobal("AudioContext", vi.fn().mockImplementation(function() { return mockAudioContext; }));
    vi.stubGlobal("AudioWorkletNode", vi.fn().mockImplementation(function() { return mockAudioWorkletNode; }));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });

    Object.defineProperty(global.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
        getDisplayMedia: vi.fn(),
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("WEB-I-03: initializes AudioContext and pipes AudioWorkletNode correctly", async () => {
    const capture = new AudioWorkletCapture();
    
    const onAudio = vi.fn();
    const onLevel = vi.fn();
    
    await capture.start({ onAudio, onLevel });
    
    expect(global.AudioContext).toHaveBeenCalled();
    expect(mockAudioContext.audioWorklet.addModule).toHaveBeenCalled();
    expect(global.AudioWorkletNode).toHaveBeenCalled();
    expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalled();
    
    // Simulate a message from the worklet with RMS for visualization
    const pcm = new Int16Array([0, 1000, -1000]).buffer;
    mockAudioWorkletNode.port.onmessage({ data: { pcm, rms: 0.5 } });
    
    expect(onAudio).toHaveBeenCalled(); // Base64 chunk
    expect(onLevel).toHaveBeenCalledWith(0.5); // Level visualization callback
    
    capture.stop();
    expect(mockAudioWorkletNode.port.close).toHaveBeenCalled();
    expect(mockAudioContext.close).toHaveBeenCalled();
  });
});
