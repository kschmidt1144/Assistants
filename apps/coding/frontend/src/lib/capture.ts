/** Frame compositing + cropping geometry (annotations baked in; region-crop). */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EncodeOpts {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

/** Where an `object-fit: contain` video's content sits inside a box of `boxW`×`boxH`. */
export function contentRect(videoW: number, videoH: number, boxW: number, boxH: number): Rect {
  if (!videoW || !videoH) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / videoW, boxH / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

function toJpegBase64(canvas: HTMLCanvasElement, quality: number): string {
  const url = canvas.toDataURL("image/jpeg", quality);
  const i = url.indexOf(",");
  return i >= 0 ? url.slice(i + 1) : url;
}

/** Full frame (downscaled) with the annotation overlay composited in. */
export function compositeFrame(
  video: HTMLVideoElement,
  overlay: HTMLCanvasElement | null,
  opts: EncodeOpts = {},
): string | null {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) return null;
  const { maxWidth = 1280, maxHeight = 720, quality = 0.92 } = opts;
  const scale = Math.min(1, maxWidth / sw, maxHeight / sh);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  if (overlay && overlay.width > 0) ctx.drawImage(overlay, 0, 0, w, h);
  return toJpegBase64(canvas, quality);
}

/**
 * Crop a `rect` (given in overlay/content coordinates) from the composited frame at source res.
 * `contentW`/`contentH` are the overlay canvas's content dimensions (== displayed video content).
 */
export function cropFrame(
  video: HTMLVideoElement,
  overlay: HTMLCanvasElement | null,
  rect: Rect,
  contentW: number,
  contentH: number,
  quality = 0.92,
): string | null {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh || !contentW || !contentH || rect.w < 4 || rect.h < 4) return null;
  const sx = sw / contentW; // content px → source px
  const sy = sh / contentH;
  const cropW = Math.max(1, Math.round(rect.w * sx));
  const cropH = Math.max(1, Math.round(rect.h * sy));
  const canvas = document.createElement("canvas");
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, rect.x * sx, rect.y * sy, cropW, cropH, 0, 0, cropW, cropH);
  if (overlay && overlay.width > 0) {
    ctx.drawImage(overlay, rect.x, rect.y, rect.w, rect.h, 0, 0, cropW, cropH);
  }
  return toJpegBase64(canvas, quality);
}
