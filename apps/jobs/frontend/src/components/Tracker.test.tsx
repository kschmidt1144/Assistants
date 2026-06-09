import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Tracker } from "./Tracker";
import { api } from "../lib/api";
import React from "react";

vi.mock("../lib/api", () => ({
  api: {
    listApplications: vi.fn(),
    stats: vi.fn(),
  }
}));

describe("Tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("JOB-C-14: Tracker filter change -> refetch list+stats", async () => {
    (api.listApplications as any).mockResolvedValue([
      { id: "app-1", title: "Test App", status: "APPLIED" }
    ]);
    (api.stats as any).mockResolvedValue({ APPLIED: 1 });

    render(<Tracker statuses={["APPLIED", "REJECTED"]} />);

    await waitFor(() => {
      expect(api.listApplications).toHaveBeenCalledWith(undefined);
      expect(api.stats).toHaveBeenCalled();
      expect(screen.getByText("Test App")).toBeInTheDocument();
      expect(screen.getAllByText("APPLIED").length).toBeGreaterThan(0);
      // Stat chip
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    // Change filter
    const select = screen.getByDisplayValue("All statuses") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "REJECTED" } });

    await waitFor(() => {
      expect(api.listApplications).toHaveBeenCalledWith("REJECTED");
    });
  });
});
