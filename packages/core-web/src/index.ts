// Media
export { AudioWorkletCapture } from "./media/AudioWorkletCapture";
export type { AudioCaptureOptions } from "./media/AudioWorkletCapture";
export { VideoCapture } from "./media/VideoCapture";
export type { VideoSourceKind, VideoDeviceInfo } from "./media/VideoCapture";
export { encodeFrameToJpegBase64 } from "./media/FrameEncoder";
export type { FrameOptions } from "./media/FrameEncoder";
export { SpeechTranscription } from "./media/SpeechTranscription";
export type { SpeechTranscriptionOptions, TranscriptResult } from "./media/SpeechTranscription";
export { AudioPlayback } from "./media/AudioPlayback";

// Realtime
export { RealtimeClient } from "./realtime/RealtimeClient";
export type { RealtimeHandlers, RealtimeOptions } from "./realtime/RealtimeClient";
export { useRealtime } from "./state/useRealtime";
export type { UseRealtimeResult } from "./state/useRealtime";

// UI kit
export { HudWindow, resetHudLayout } from "./ui/HudWindow";
export type { HudWindowProps, HudWindowState, HudTone } from "./ui/HudWindow";
export { DraggableWindow } from "./ui/DraggableWindow";
export type { DraggableWindowProps } from "./ui/DraggableWindow";
export { MarkdownRenderer } from "./ui/MarkdownRenderer";
export type { MarkdownRendererProps } from "./ui/MarkdownRenderer";

// Protocol
export type { ClientMessage, ServerMessage, ServerMessageType } from "./protocol";
