import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { App } from "./App";
import { api } from "./lib/api";
import { download } from "./lib/format";
import React from "react";

vi.mock("./lib/api", () => ({
  api: {
    listMeetings: vi.fn().mockResolvedValue([]),
    voiceProfiles: vi.fn().mockResolvedValue([]),
    createMeeting: vi.fn(),
    appendEntries: vi.fn(),
    updateMeeting: vi.fn(),
    getMeeting: vi.fn(),
  }
}));

vi.mock("./lib/format", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    download: vi.fn(),
  };
});

vi.mock("@assistants/core-web", () => ({
  SpeechTranscription: Object.assign(vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })), { isSupported: () => true }),
  AudioWorkletCapture: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  MarkdownRenderer: ({ content }: any) => <div data-testid="markdown">{content}</div>
}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
  });

  it("MTG-C-11: Save flow -> append new entries, onLoad repopulates, export downloads md", async () => {
    (api.listMeetings as any).mockResolvedValue([{ id: "meet-1", title: "Topic", updated_at: 0 }]);
    (api.createMeeting as any).mockResolvedValue({ id: "meet-1", title: "Topic" });
    (api.getMeeting as any).mockResolvedValue({
      session: { id: "meet-1", title: "Loaded Topic", metadata: { summary: "Loaded summary" } },
      entries: [{ ts: 100, speaker: "Alice", text: "Hi" }]
    });

    const { rerender } = render(<App />);

    // Wait for meetings to load
    await waitFor(() => {
      expect(screen.getByText("Topic")).toBeInTheDocument();
    });

    // Load meeting
    const historySelect = screen.getByDisplayValue("History…") as HTMLSelectElement;
    fireEvent.change(historySelect, { target: { value: "meet-1" } });

    await waitFor(() => {
      expect(api.getMeeting).toHaveBeenCalledWith("meet-1");
    });

    // Verify it repopulated topic, summary, entries
    const topicInput = screen.getByPlaceholderText("Meeting topic…") as HTMLInputElement;
    expect(topicInput.value).toBe("Loaded Topic");
    
    expect(screen.getByText("Loaded summary")).toBeInTheDocument();
    expect(screen.getByText("Hi")).toBeInTheDocument();

    // Export
    const exportBtn = screen.getByText("Export");
    fireEvent.click(exportBtn);

    expect(download).toHaveBeenCalled();
    const downloadArgs = (download as any).mock.calls[0];
    expect(downloadArgs[0]).toMatch(/^meeting-\d+\.md$/);
    expect(downloadArgs[1]).toContain("# Loaded Topic");
    expect(downloadArgs[1]).toContain("Alice: Hi");
    expect(downloadArgs[1]).toContain("## Summary");
    expect(downloadArgs[1]).toContain("Loaded summary");

    // Save with no new entries - should update meeting but not append entries
    const saveBtn = screen.getByText("Save");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.updateMeeting).toHaveBeenCalledWith("meet-1", { title: "Loaded Topic" });
      expect(api.updateMeeting).toHaveBeenCalledWith("meet-1", { summary: "Loaded summary" });
      expect(api.appendEntries).not.toHaveBeenCalled();
    });
  });
});

