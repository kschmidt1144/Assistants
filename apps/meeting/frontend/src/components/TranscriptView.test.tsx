import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TranscriptView } from "./TranscriptView";
import React from "react";

describe("TranscriptView", () => {
  it("MTG-C-10: interim line + auto-scroll", () => {
    const { container, rerender } = render(<TranscriptView entries={[]} interim="" currentSpeaker="" />);
    expect(screen.getByText(/Press ● Record to start live transcription/)).toBeInTheDocument();

    const scrollDiv = container.querySelector(".scroll") as HTMLDivElement;
    let scrollTopSetter = vi.fn();
    Object.defineProperty(scrollDiv, "scrollTop", { set: scrollTopSetter });
    Object.defineProperty(scrollDiv, "scrollHeight", { get: () => 100 });

    rerender(<TranscriptView entries={[]} interim="hello" currentSpeaker="Kevin" />);
    
    expect(screen.getByText(/hello/)).toBeInTheDocument();
    expect(screen.getByText("Kevin:")).toBeInTheDocument();
    expect(scrollTopSetter).toHaveBeenCalledWith(100);

    rerender(<TranscriptView entries={[{ ts: 0, speaker: "Kevin", text: "hello" }]} interim="" currentSpeaker="" />);
    expect(scrollTopSetter).toHaveBeenCalledTimes(2); // once for interim, once for new entry
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
