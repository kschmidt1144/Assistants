/** Camera / screen / capture-card video capture + per-frame JPEG extraction. */

import { encodeFrameToJpegBase64, type FrameOptions } from "./FrameEncoder";

export type VideoSourceKind = "camera" | "screen" | "device" | "none";

export interface VideoDeviceInfo {
  deviceId: string;
  label: string;
}

export class VideoCapture {
  /** Hidden element the stream is rendered into; read by `captureFrame`. */
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private _kind: VideoSourceKind = "none";

  constructor() {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
  }

  get kind(): VideoSourceKind {
    return this._kind;
  }

  get active(): boolean {
    return this.stream !== null;
  }

  async startCamera(): Promise<MediaStream> {
    return this.attach(
      await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      }),
      "camera",
    );
  }

  async startScreen(): Promise<MediaStream> {
    return this.attach(
      await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      }),
      "screen",
    );
  }

  /** Capture from a specific input device (e.g. an Elgato capture card). */
  async startDevice(deviceId: string): Promise<MediaStream> {
    return this.attach(
      await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      }),
      "device",
    );
  }

  static async listVideoInputs(): Promise<VideoDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput")
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  }

  private async attach(stream: MediaStream, kind: VideoSourceKind): Promise<MediaStream> {
    this.stop();
    this.stream = stream;
    this._kind = kind;
    this.video.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    if (track) track.addEventListener("ended", () => this.stop());
    try {
      await this.video.play();
    } catch {
      /* autoplay may resolve later; frames still capture once playing */
    }
    return stream;
  }

  /** Grab the current frame as base64 JPEG, or `null` if no frame is ready. */
  captureFrame(opts?: FrameOptions): string | null {
    if (!this.stream) return null;
    return encodeFrameToJpegBase64(this.video, opts);
  }

  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    this._kind = "none";
  }
}
