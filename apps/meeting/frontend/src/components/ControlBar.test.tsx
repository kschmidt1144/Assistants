import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ControlBar } from "./ControlBar";
import React from "react";

describe("ControlBar", () => {
  it("MTG-C-10: record disabled when speech unsupported", () => {
    const props = {
      live: false,
      onToggleLive: vi.fn(),
      sysAudio: false,
      onToggleSysAudio: vi.fn(),
      level: 0,
      topic: "",
      setTopic: vi.fn(),
      elapsedStr: "00:00",
      saving: false,
      onSave: vi.fn(),
      onExport: vi.fn(),
      meetings: [],
      onLoad: vi.fn(),
      onOpenProfiles: vi.fn(),
    };

    const { rerender } = render(<ControlBar speechSupported={false} {...props} />);
    
    const recBtn = screen.getByText("▶ Record");
    expect(recBtn).toBeDisabled();
    expect(recBtn).toHaveAttribute("title", "Web Speech API not supported — use Chrome");

    rerender(<ControlBar speechSupported={true} {...props} />);
    expect(recBtn).toBeEnabled();
    expect(recBtn).not.toHaveAttribute("title", "Web Speech API not supported — use Chrome");
  });
});
