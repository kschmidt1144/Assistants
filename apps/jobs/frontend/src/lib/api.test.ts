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

  it("JOB-U-12: API wrapper mock fetch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ["APPLIED", "REJECTED"],
    });

    const statuses = await api.statuses();
    expect(statuses).toEqual(["APPLIED", "REJECTED"]);
    expect(mockFetch).toHaveBeenCalledWith("/api/statuses", undefined);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1" }),
    });

    await api.createApplication({ title: "Software Engineer", jd_text: "JD" });
    expect(mockFetch).toHaveBeenCalledWith("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Software Engineer", jd_text: "JD" }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });

    await expect(api.parseJd("abc")).rejects.toThrow("400: Bad Request");
  });
});
