/** Browser-side realtime WebSocket client over the shared protocol envelope. */

import type { ClientMessage, ServerMessage } from "../protocol";

export interface RealtimeHandlers {
  onOpen?: () => void;
  onClose?: () => void;
  onStatus?: (status: string) => void;
  onText?: (delta: string) => void;
  onTranscript?: (text: string, speaker?: string, final?: boolean) => void;
  onAudio?: (base64: string) => void;
  onTurnComplete?: () => void;
  onError?: (message: string) => void;
}

export interface RealtimeOptions {
  /** Auto-reconnect on unexpected drops (not on an intentional `close()`). Default true. */
  reconnect?: boolean;
  /** Max reconnect attempts before giving up. Default 5. */
  maxRetries?: number;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private intentionalClose = false;
  private retries = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: RealtimeHandlers = {},
    private readonly options: RealtimeOptions = {},
  ) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.intentionalClose = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      this.handlers.onOpen?.();
    };
    ws.onmessage = (event) => this.dispatch(event.data);
    ws.onerror = () => this.handlers.onError?.("websocket error");
    ws.onclose = () => {
      this.handlers.onClose?.();
      if (!this.intentionalClose) this.scheduleReconnect();
    };
  }

  private dispatch(raw: unknown): void {
    if (typeof raw !== "string") return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      this.handlers.onError?.("malformed server message");
      return;
    }
    switch (msg.type) {
      case "status":
        this.handlers.onStatus?.(msg.data);
        break;
      case "text":
        this.handlers.onText?.(msg.data);
        break;
      case "transcript":
        this.handlers.onTranscript?.(msg.text, msg.speaker, msg.final);
        break;
      case "audio":
        this.handlers.onAudio?.(msg.data);
        break;
      case "turnComplete":
        this.handlers.onTurnComplete?.();
        break;
      case "error":
        this.handlers.onError?.(msg.data);
        break;
    }
  }

  private scheduleReconnect(): void {
    const { reconnect = true, maxRetries = 5 } = this.options;
    if (!reconnect || this.retries >= maxRetries) return;
    const delay = Math.min(1000 * 2 ** this.retries, 15000);
    this.retries += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendConfig(system?: string, model?: string): void {
    this.send({ type: "config", system, model });
  }
  sendAudio(base64: string): void {
    this.send({ type: "audio", data: base64 });
  }
  sendImage(base64: string): void {
    this.send({ type: "image", data: base64 });
  }
  sendText(text: string): void {
    this.send({ type: "text", data: text });
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close(1000);
    this.ws = null;
  }
}
