import { describe, it, expect } from "vitest";
import type { ClientMessage, ServerMessage } from "./protocol";

describe("protocol shapes", () => {
  it("WEB-I-01: verifies ClientMessage union types", () => {
    // Compile-time check
    const msg: ClientMessage = { type: "config", system: "prompt" };
    expect(msg.type).toBe("config");
    expect(msg).toHaveProperty("system");
  });

  it("WEB-I-01: verifies ServerMessage union types", () => {
    // Compile-time check
    const msg: ServerMessage = { type: "transcript", text: "hello", final: true };
    expect(msg.type).toBe("transcript");
    expect(msg).toHaveProperty("final");
  });
});
