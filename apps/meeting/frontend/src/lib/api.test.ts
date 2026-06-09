import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./api";

describe("api", () => {
  const originalFetch = globalThis.fetch;
  const mockFetch = vi.fn();

  beforeEach(() => {
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockFetch.mockReset();
  });

  it("MTG-U-09: request shaping incl. encodeURIComponent on profile delete", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await api.deleteProfile("Kevin/Admin");
    
    expect(mockFetch).toHaveBeenCalledWith("/api/voice-profiles/Kevin%2FAdmin", {
      method: "DELETE",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ summary: "Test" }),
    });

    await api.summarize("abc");
    expect(mockFetch).toHaveBeenCalledWith("/api/summarize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: "abc" }),
    });
  });
});
