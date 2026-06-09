import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotesPanel } from "./NotesPanel";
import React from "react";

// Mock core-web
vi.mock("@assistants/core-web", () => ({
  MarkdownRenderer: ({ content }: any) => <div data-testid="markdown">{content}</div>
}));

describe("NotesPanel", () => {
  it("MTG-C-10: buttons disabled unless entries.length>0 && !busy", () => {
    const defaultProps = {
      summary: "",
      actionItems: [],
      cleaned: "",
      answer: "",
      question: "",
      setQuestion: vi.fn(),
      onSummary: vi.fn(),
      onActions: vi.fn(),
      onClean: vi.fn(),
      onAsk: vi.fn(),
      onUseSelection: vi.fn(),
    };

    const { rerender } = render(<NotesPanel hasTranscript={false} busy={null} {...defaultProps} />);
    
    // hasTranscript = false -> buttons disabled
    expect(screen.getByRole("button", { name: "Summary" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Action items" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clean" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();

    rerender(<NotesPanel hasTranscript={true} busy={null} {...defaultProps} />);
    
    // hasTranscript = true -> buttons enabled
    expect(screen.getByRole("button", { name: "Summary" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Action items" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Clean" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ask" })).toBeEnabled();

    rerender(<NotesPanel hasTranscript={true} busy="Working" {...defaultProps} />);
    
    // busy -> buttons disabled
    expect(screen.getByRole("button", { name: "Summary" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Action items" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clean" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    expect(screen.getByText("Notes · Working…")).toBeInTheDocument();
  });
});
