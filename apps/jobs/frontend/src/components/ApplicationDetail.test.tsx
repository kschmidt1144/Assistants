import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApplicationDetail } from "./ApplicationDetail";
import { api } from "../lib/api";
import type { Application } from "../lib/types";
import React from "react";

vi.mock("../lib/api", () => ({
  api: {
    updateApplication: vi.fn(),
    deleteApplication: vi.fn(),
    tailor: vi.fn(),
    coverLetter: vi.fn(),
    answerQuestion: vi.fn(),
  }
}));

vi.mock("@assistants/core-web", () => ({
  MarkdownRenderer: () => <div data-testid="markdown" />
}));

const mockApp: Application = {
  id: "app-1",
  title: "Title",
  company: "Company",
  url: "",
  location: "",
  jd_text: "",
  parsed_data: null,
  status: "APPLIED",
  notes: "Some notes",
  status_history: [{ status: "APPLIED", date: 0 }],
  created_at: 0,
  updated_at: 0,
};

describe("ApplicationDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:test");
    window.URL.revokeObjectURL = vi.fn();
  });

  it("JOB-C-13: ATS score color class thresholds, status-change->PUT, notes-on-blur->PUT, delete behind confirm", async () => {
    const onChanged = vi.fn();
    const onDeleted = vi.fn();
    
    const { rerender } = render(
      <ApplicationDetail app={mockApp} statuses={["APPLIED", "REJECTED"]} onChanged={onChanged} onDeleted={onDeleted} />
    );

    // Delete
    const deleteBtn = screen.getByText("Delete");
    fireEvent.click(deleteBtn);
    expect(window.confirm).toHaveBeenCalledWith("Delete this application?");
    await waitFor(() => {
      expect(api.deleteApplication).toHaveBeenCalledWith("app-1");
      expect(onDeleted).toHaveBeenCalled();
    });

    // Status change
    const statusSelect = screen.getByDisplayValue("APPLIED") as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: "REJECTED" } });
    await waitFor(() => {
      expect(api.updateApplication).toHaveBeenCalledWith("app-1", { status: "REJECTED" });
      expect(onChanged).toHaveBeenCalled();
    });

    // Notes blur
    const notesArea = screen.getByDisplayValue("Some notes") as HTMLTextAreaElement;
    fireEvent.change(notesArea, { target: { value: "New notes" } });
    fireEvent.blur(notesArea);
    await waitFor(() => {
      expect(api.updateApplication).toHaveBeenCalledWith("app-1", { notes: "New notes" });
    });

    // Tailor & ATS score colors
    (api.tailor as any).mockResolvedValue({
      resume_markdown: "resume",
      ats: { score: 85, missing: [] },
      iterations: 1,
    });
    
    const tailorBtn = screen.getByText("Tailor resume");
    fireEvent.click(tailorBtn);
    expect(tailorBtn).toHaveTextContent("Tailoring…");
    
    await waitFor(() => {
      const score = screen.getByText("85");
      expect(score).toHaveClass("good"); // >= 80
    });

    (api.tailor as any).mockResolvedValue({
      resume_markdown: "resume",
      ats: { score: 65, missing: [] },
      iterations: 1,
    });
    fireEvent.click(tailorBtn);
    await waitFor(() => {
      const score = screen.getByText("65");
      expect(score).toHaveClass("warn"); // >= 60
    });

    (api.tailor as any).mockResolvedValue({
      resume_markdown: "resume",
      ats: { score: 50, missing: [] },
      iterations: 1,
    });
    fireEvent.click(tailorBtn);
    await waitFor(() => {
      const score = screen.getByText("50");
      expect(score).toHaveClass("bad"); // < 60
    });
  });
});
