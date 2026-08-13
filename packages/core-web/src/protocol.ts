/**
 * The realtime WebSocket protocol — the single contract between `core-web` (browser) and the
 * app backends (`core-py`). One normalized envelope replaces the three different dialects the
 * prototypes used.
 */

/** Browser → backend. */
export type ClientMessage =
  | { type: "config"; system?: string; model?: string; voice?: string }
  | { type: "audio"; data: string } // base64 PCM16 @ 16kHz mono
  | { type: "image"; data: string } // base64 JPEG frame
  | { type: "text"; data: string }
  | { type: "multimodal"; text: string; image: string };

/** Backend → browser. */
export type ServerMessage =
  | { type: "status"; data: string }
  | { type: "text"; data: string } // streamed model text delta
  | { type: "transcript"; text: string; speaker?: string; final?: boolean }
  | { type: "audio"; data: string } // base64 model audio (optional voice-out)
  | { type: "turnComplete" }
  | { type: "error"; data: string };

export type ServerMessageType = ServerMessage["type"];
