/**
 * Gapless playback of streamed base64 PCM16 audio — for Gemini native-audio output (24kHz mono).
 * Finally lights up the voice-out path every prototype configured but never played.
 */

export class AudioPlayback {
  private ctx: AudioContext | null = null;
  private nextTime = 0;

  constructor(private readonly sampleRate = 24_000) {}

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.nextTime = this.ctx.currentTime;
    }
    return this.ctx;
  }

  /** Queue one base64 PCM16 chunk; chunks play back-to-back. */
  enqueue(base64Pcm: string): void {
    const ctx = this.context();
    const binary = atob(base64Pcm);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const count = Math.floor(bytes.byteLength / 2);
    if (count === 0) return;
    const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, count);
    const f32 = new Float32Array(count);
    for (let i = 0; i < count; i++) f32[i] = (i16[i] ?? 0) / 32768;

    const buffer = ctx.createBuffer(1, count, this.sampleRate);
    buffer.getChannelData(0).set(f32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const start = Math.max(this.nextTime, ctx.currentTime);
    source.start(start);
    this.nextTime = start + buffer.duration;
  }

  stop(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.nextTime = 0;
  }
}
