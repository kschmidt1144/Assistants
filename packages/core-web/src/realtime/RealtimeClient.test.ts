import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RealtimeClient } from "./RealtimeClient";

describe("RealtimeClient", () => {
  let mockWebSocket: any;

  beforeEach(() => {
    mockWebSocket = {
      readyState: 0,
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("WebSocket", vi.fn().mockImplementation(function() { return mockWebSocket; }));
    // Provide WebSocket.OPEN constant
    (global as any).WebSocket.OPEN = 1;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllTimers();
  });

  it("WEB-I-02: K8 - queues messages sent before OPEN and flushes them on open", () => {
    const client = new RealtimeClient("ws://localhost");
    client.connect();

    // Not open yet (readyState 0): message is queued, not sent.
    client.sendText("early");
    expect(mockWebSocket.send).not.toHaveBeenCalled();

    // On open, the queued message flushes in order.
    mockWebSocket.readyState = 1; // WebSocket.OPEN
    mockWebSocket.onopen?.();
    expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "text", data: "early" }));

    // After open, sends go straight through.
    client.sendText("live");
    expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "text", data: "live" }));
    expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
  });

  it("WEB-I-02: K8 - does not flush messages queued before an intentional close", () => {
    const client = new RealtimeClient("ws://localhost");
    client.connect();
    client.sendText("early");

    client.close(); // intentional close clears the queue
    const reopened: any = { readyState: 1, send: vi.fn(), close: vi.fn() };
    vi.stubGlobal("WebSocket", vi.fn().mockImplementation(function () { return reopened; }));
    client.connect();
    reopened.onopen?.();
    expect(reopened.send).not.toHaveBeenCalled();
  });

  it("WEB-I-02: handles state machine and dispatches ServerMessage", () => {
    const onText = vi.fn();
    const onStatus = vi.fn();
    const client = new RealtimeClient("ws://localhost", { onText, onStatus });
    client.connect();

    mockWebSocket.readyState = 1;
    mockWebSocket.onopen?.();

    // Test receiving valid message
    mockWebSocket.onmessage?.({ data: JSON.stringify({ type: "text", data: "hi" }) });
    expect(onText).toHaveBeenCalledWith("hi");

    mockWebSocket.onmessage?.({ data: JSON.stringify({ type: "status", data: "connected" }) });
    expect(onStatus).toHaveBeenCalledWith("connected");
  });

  it("WEB-I-02: handles reconnect on unexpected drop", () => {
    vi.useFakeTimers();
    const client = new RealtimeClient("ws://localhost", {}, { reconnect: true, maxRetries: 3 });
    client.connect();

    // Simulate drop
    mockWebSocket.onclose?.();

    // Should reconnect after 1000ms delay (2^0 * 1000)
    vi.advanceTimersByTime(1000);
    expect(global.WebSocket).toHaveBeenCalledTimes(2); // Initial connect + 1 retry

    vi.useRealTimers();
  });

  it("WEB-I-02: does not reconnect on intentional close", () => {
    vi.useFakeTimers();
    const client = new RealtimeClient("ws://localhost", {}, { reconnect: true });
    client.connect();

    client.close();
    mockWebSocket.onclose?.();

    vi.advanceTimersByTime(5000);
    expect(global.WebSocket).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
