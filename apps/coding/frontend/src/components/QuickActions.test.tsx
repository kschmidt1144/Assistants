import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickActions } from "./QuickActions";
import type { QuickAction } from "../lib/actions";
import React from "react";

const runScreen = vi.fn();
const runReview = vi.fn();
const onClose = vi.fn();

function actions(): QuickAction[] {
  return [
    { id: "analyze-screen", label: "Analyze screen", hint: "whole frame", icon: "🔬", shortcut: "A", group: "Capture", run: runScreen },
    { id: "ocr", label: "Extract text (OCR)", hint: "read text", icon: "🔤", shortcut: "O", group: "Capture", run: vi.fn(), disabled: true },
    { id: "tpl-review", label: "Review", hint: "review the code on screen", icon: "⌨", group: "Tasks", run: runReview },
  ];
}

const search = () => screen.getByRole("combobox", { name: /search quick actions/i });

describe("QuickActions palette", () => {
  beforeEach(() => {
    runScreen.mockClear();
    runReview.mockClear();
    onClose.mockClear();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<QuickActions open={false} actions={actions()} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it("filters by query and runs the match on Enter", () => {
    render(<QuickActions open actions={actions()} onClose={onClose} />);
    fireEvent.change(search(), { target: { value: "review" } });

    expect(screen.getByRole("option", { name: /Review/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Analyze screen/ })).toBeNull();

    fireEvent.keyDown(search(), { key: "Enter" });
    expect(runReview).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs an action on click", () => {
    render(<QuickActions open actions={actions()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("option", { name: /Analyze screen/ }));
    expect(runScreen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a disabled action", () => {
    render(<QuickActions open actions={actions()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("option", { name: /Extract text/ }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    render(<QuickActions open actions={actions()} onClose={onClose} />);
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
