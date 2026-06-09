import { describe, it, expect, vi, afterEach } from "vitest";
import { clockOf, elapsed, entriesToText, download } from "./format";

describe("format", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("MTG-U-08: clockOf / elapsed / entriesToText", () => {
    // pin timezone behavior by overriding Date methods for the test
    const mockDate = new Date(1700000000 * 1000); // 2023-11-14T22:13:20Z
    
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(22);
    vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(13);
    vi.spyOn(Date.prototype, 'getSeconds').mockReturnValue(20);

    expect(clockOf(1700000000)).toBe("22:13:20");

    expect(elapsed(0)).toBe("00:00");
    expect(elapsed(65)).toBe("01:05");
    expect(elapsed(3600)).toBe("60:00");

    const text = entriesToText([
      { ts: 1700000000, speaker: "Alice", text: "Hello" },
      { ts: 1700000000, speaker: "Bob", text: "Hi" }
    ]);
    expect(text).toBe("[22:13:20] Alice: Hello\n[22:13:20] Bob: Hi");
  });

  it("MTG-U-08: download builds Blob+anchor", () => {
    const mockCreateObjectURL = vi.fn().mockReturnValue("blob:test");
    const mockRevokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = mockCreateObjectURL;
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

    const mockClick = vi.fn();
    const mockAnchor = {
      href: "",
      download: "",
      click: mockClick,
    } as unknown as HTMLAnchorElement;

    vi.spyOn(document, "createElement").mockReturnValue(mockAnchor);

    download("test.md", "content");

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockAnchor.href).toBe("blob:test");
    expect(mockAnchor.download).toBe("test.md");
    expect(mockClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
