/** Minimal React hook around RealtimeClient: connection state + accumulated assistant text. */

import { useEffect, useRef, useState } from "react";
import { RealtimeClient, type RealtimeHandlers, type RealtimeOptions } from "../realtime/RealtimeClient";

export interface UseRealtimeResult {
  connected: boolean;
  /** Assistant text for the in-progress turn (resets on each new turn). */
  text: string;
  client: RealtimeClient;
}

/** `url` and `options` are read once at mount; pass new ones by remounting. */
export function useRealtime(
  url: string,
  handlers: RealtimeHandlers = {},
  options: RealtimeOptions = {},
): UseRealtimeResult {
  const [connected, setConnected] = useState(false);
  const [text, setText] = useState("");

  // Keep the latest handlers reachable without re-creating the client.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const clientRef = useRef<RealtimeClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new RealtimeClient(
      url,
      {
        onOpen: () => {
          setConnected(true);
          handlersRef.current.onOpen?.();
        },
        onClose: () => {
          setConnected(false);
          handlersRef.current.onClose?.();
        },
        onText: (delta) => {
          setText((t) => t + delta);
          handlersRef.current.onText?.(delta);
        },
        onTurnComplete: () => {
          setText("");
          handlersRef.current.onTurnComplete?.();
        },
        onStatus: (s) => handlersRef.current.onStatus?.(s),
        onTranscript: (t, sp, f) => handlersRef.current.onTranscript?.(t, sp, f),
        onAudio: (a) => handlersRef.current.onAudio?.(a),
        onError: (e) => handlersRef.current.onError?.(e),
      },
      options,
    );
  }

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    client.connect();
    return () => client.close();
  }, []);

  return { connected, text, client: clientRef.current };
}
