import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddJob } from "./AddJob";
import { api } from "../lib/api";
import React from "react";

vi.mock("../lib/api", () => ({
  api: {
    parseJd: vi.fn(),
    createApplication: vi.fn(),
  }
}));

describe("AddJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("JOB-C-14: parse populates title/company, Track clears form + onTracked", async () => {
    const onTracked = vi.fn();
    render(<AddJob onTracked={onTracked} />);

    const jdArea = screen.getByPlaceholderText("Paste the job description…") as HTMLTextAreaElement;
    fireEvent.change(jdArea, { target: { value: "Job text here" } });

    // Parse
    (api.parseJd as any).mockResolvedValue({
      title: "Senior Eng",
      company: "Tech Corp",
      seniority: "Senior",
      work_type: "Remote",
      employment_type: "Full-time",
      required_skills: ["React"],
      preferred_skills: [],
    });

    const parseBtn = screen.getByText("Parse JD (AI)");
    fireEvent.click(parseBtn);
    expect(parseBtn).toHaveTextContent("Parsing…");

    await waitFor(() => {
      const titleInput = screen.getByPlaceholderText("Title") as HTMLInputElement;
      expect(titleInput.value).toBe("Senior Eng");
      
      const companyInput = screen.getByPlaceholderText("Company") as HTMLInputElement;
      expect(companyInput.value).toBe("Tech Corp");
      
      expect(screen.getByText("Senior Eng")).toBeInTheDocument(); // The parsed result header
      expect(screen.getByText("React")).toBeInTheDocument(); // Skill chip
    });

    // Track
    const trackBtn = screen.getByText("Track");
    fireEvent.click(trackBtn);
    expect(trackBtn).toHaveTextContent("Saving…");

    await waitFor(() => {
      expect(api.createApplication).toHaveBeenCalledWith({
        title: "Senior Eng",
        company: "Tech Corp",
        url: null,
        jd_text: "Job text here",
        parsed_data: expect.any(Object),
      });

      // Form should be cleared
      const jdAreaRefreshed = screen.getByPlaceholderText("Paste the job description…") as HTMLTextAreaElement;
      expect(jdAreaRefreshed.value).toBe("");

      expect(onTracked).toHaveBeenCalled();
    });
  });
});
