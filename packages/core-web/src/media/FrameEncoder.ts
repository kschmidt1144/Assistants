/** Downscale + JPEG-encode a video/canvas frame to base64 (prefix stripped). */

export interface FrameOptions {
  /** Max output width in px (aspect preserved). Default 1280. */
  maxWidth?: number;
  /** Max output height in px (aspect preserved). Default 720. */
  maxHeight?: number;
  /** JPEG quality 0–1. Default 0.7 (live) — use ~0.92 for deep analysis. */
  quality?: number;
}

function sourceDims(source: HTMLVideoElement | HTMLCanvasElement): [number, number] {
  if (source instanceof HTMLVideoElement) return [source.videoWidth, source.videoHeight];
  return [source.width, source.height];
}

/** Returns raw base64 (no `data:` prefix), or `null` if the source has no frame yet. */
export function encodeFrameToJpegBase64(
  source: HTMLVideoElement | HTMLCanvasElement,
  opts: FrameOptions = {},
): string | null {
  const { maxWidth = 1280, maxHeight = 720, quality = 0.7 } = opts;
  const [sw, sh] = sourceDims(source);
  if (!sw || !sh) return null;

  const scale = Math.min(1, maxWidth / sw, maxHeight / sh);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}
