import { AudioWorkletCapture } from "@assistants/core-web";

/** Record one short PCM16 clip from the mic and resolve its base64 (≈ samples/16000 seconds). */
export function recordClip(samples = 32000): Promise<string> {
  return new Promise((resolve, reject) => {
    const cap = new AudioWorkletCapture();
    let done = false;
    cap
      .start({
        chunkSize: samples,
        onAudio: (b64) => {
          if (done) return;
          done = true;
          cap.stop();
          resolve(b64);
        },
      })
      .catch((e) => {
        cap.stop();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}
