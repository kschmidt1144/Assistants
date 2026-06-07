/**
 * Microphone (+ optional system audio) capture → PCM16 16kHz mono → base64, via an **AudioWorklet**
 * (replaces every prototype's deprecated `ScriptProcessorNode`). The worklet batches frames and
 * converts to Int16 off the main thread; the main thread only base64-encodes and forwards.
 */

export interface AudioCaptureOptions {
  /** Also capture system/tab audio (via getDisplayMedia) and mix it into the same PCM stream. */
  captureSystemAudio?: boolean;
  /** Samples per posted chunk (≈ chunkSize/16000 seconds). Default 2048 (~128ms). */
  chunkSize?: number;
  /** Called with each base64 PCM16 chunk. */
  onAudio: (pcm16Base64: string) => void;
  /** Called with the RMS level (0–1) of each chunk, for a level meter. */
  onLevel?: (rms: number) => void;
}

// Authored for AudioWorkletGlobalScope; shipped as a string and loaded via a Blob URL so the
// library needs no separate asset/build step. (btoa isn't available here — base64 is done on the
// main thread.)
const WORKLET_SOURCE = `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this._target = o.chunkSize || 2048;
    this._buf = new Float32Array(this._target);
    this._n = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this._buf[this._n++] = channel[i];
        if (this._n >= this._target) this._flush();
      }
    }
    return true;
  }
  _flush() {
    const n = this._n;
    const pcm = new Int16Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let s = this._buf[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      sum += s * s;
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage({ pcm: pcm.buffer, rms: Math.sqrt(sum / n) }, [pcm.buffer]);
    this._n = 0;
  }
}
registerProcessor('pcm-capture', PCMCaptureProcessor);
`;

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class AudioWorkletCapture {
  private ctx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private sysStream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private workletUrl: string | null = null;

  get active(): boolean {
    return this.node !== null;
  }

  async start(opts: AudioCaptureOptions): Promise<void> {
    if (this.active) return;
    const { captureSystemAudio = false, chunkSize = 2048, onAudio, onLevel } = opts;

    const ctx = new AudioContext({ sampleRate: 16000 });
    this.ctx = ctx;

    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    this.workletUrl = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(this.workletUrl);

    const node = new AudioWorkletNode(ctx, "pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      processorOptions: { chunkSize },
    });
    this.node = node;
    node.port.onmessage = (event: MessageEvent) => {
      const { pcm, rms } = event.data as { pcm: ArrayBuffer; rms: number };
      onAudio(base64FromArrayBuffer(pcm));
      onLevel?.(rms);
    };

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });
    ctx.createMediaStreamSource(this.micStream).connect(node);

    if (captureSystemAudio) {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      // We only want the audio track; drop the video the browser forced us to request.
      for (const track of display.getVideoTracks()) track.stop();
      if (display.getAudioTracks().length === 0) {
        throw new Error("No system audio track — share a tab/window *with audio*.");
      }
      this.sysStream = display;
      ctx.createMediaStreamSource(display).connect(node);
    }

    // Keep the worklet pulling by routing it to the destination through a muted gain (no echo).
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    for (const stream of [this.micStream, this.sysStream]) {
      stream?.getTracks().forEach((t) => t.stop());
    }
    this.micStream = null;
    this.sysStream = null;
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
    void this.ctx?.close();
    this.ctx = null;
  }
}
