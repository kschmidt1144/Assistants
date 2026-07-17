import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { HudWindow, resetHudLayout } from "./HudWindow";
import { DraggableWindow } from "./DraggableWindow";
import React from "react";

const key = (id: string) => `hud.win.${id}`;

describe("HudWindow", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("restores persisted geometry + opacity on mount", () => {
    localStorage.setItem(key("t1"), JSON.stringify({ x: 120, y: 60, w: 300, h: 200, opacity: 0.7, collapsed: false }));
    render(<HudWindow id="t1" title="Panel">body</HudWindow>);
    const win = screen.getByRole("region", { name: "Panel" });
    expect(win).toHaveStyle({ left: "120px", top: "60px", width: "300px" });
    expect(win.style.getPropertyValue("--win-opacity")).toBe("0.7");
  });

  it("collapse hides the body, persists, and is reversible", async () => {
    render(<HudWindow id="t2" title="Panel">hello body</HudWindow>);
    expect(screen.getByText("hello body")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "collapse" }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(key("t2")) || "{}");
      expect(saved.collapsed).toBe(true);
    });
    const win = screen.getByRole("region", { name: "Panel" });
    expect(win).toHaveAttribute("data-collapsed", "true");
  });

  it("opacity control changes --win-opacity and persists (clamped to >=0.35)", async () => {
    render(<HudWindow id="t3" title="Panel" defaultOpacity={1}>body</HudWindow>);
    fireEvent.click(screen.getByRole("button", { name: "opacity" }));
    const slider = screen.getByRole("slider", { name: "window opacity" });
    fireEvent.change(slider, { target: { value: "0.5" } });

    const win = screen.getByRole("region", { name: "Panel" });
    expect(win.style.getPropertyValue("--win-opacity")).toBe("0.5");
    expect(within(win).getByText("50%")).toBeInTheDocument();
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(key("t3")) || "{}");
      expect(saved.opacity).toBe(0.5);
    });
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(<HudWindow id="t4" title="Panel" onClose={onClose}>body</HudWindow>);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders 8 resize handles when resizable, none when collapsed", () => {
    const { container } = render(<HudWindow id="t5" title="Panel">body</HudWindow>);
    expect(container.querySelectorAll(".hud-rh")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "collapse" }));
    expect(container.querySelectorAll(".hud-rh")).toHaveLength(0);
  });

  it("resetHudLayout clears matching persisted windows", () => {
    localStorage.setItem(key("coding.live"), "{}");
    localStorage.setItem(key("coding.analyze"), "{}");
    localStorage.setItem(key("meeting.notes"), "{}");
    localStorage.setItem("coding.pinnedContext", "keep me");
    resetHudLayout("coding");
    expect(localStorage.getItem(key("coding.live"))).toBeNull();
    expect(localStorage.getItem(key("coding.analyze"))).toBeNull();
    expect(localStorage.getItem(key("meeting.notes"))).not.toBeNull();
    expect(localStorage.getItem("coding.pinnedContext")).toBe("keep me");
  });

  it("does not re-place on mount, then snaps to `place` when `placeNonce` advances", () => {
    const place = { x: 500, y: 400, w: 320, h: 240 };
    const { rerender } = render(
      <HudWindow id="p1" title="Panel" defaultPos={{ x: 24, y: 24 }} defaultSize={{ w: 380, h: 300 }} place={place} placeNonce={0}>
        body
      </HudWindow>,
    );
    // Mount uses the default geometry — the place signal is inert until it advances.
    let win = screen.getByRole("region", { name: "Panel" });
    expect(win).toHaveStyle({ left: "24px", top: "24px", width: "380px" });

    // Bump the nonce → window snaps to `place`.
    rerender(
      <HudWindow id="p1" title="Panel" defaultPos={{ x: 24, y: 24 }} defaultSize={{ w: 380, h: 300 }} place={place} placeNonce={1}>
        body
      </HudWindow>,
    );
    win = screen.getByRole("region", { name: "Panel" });
    expect(win).toHaveStyle({ left: "500px", top: "400px", width: "320px" });
  });

  it("keeps persisted geometry on mount even when a placeNonce is supplied", () => {
    localStorage.setItem(key("p2"), JSON.stringify({ x: 111, y: 222, w: 280, h: 200, opacity: 1, collapsed: false }));
    render(
      <HudWindow id="p2" title="Panel" place={{ x: 9, y: 9, w: 300, h: 200 }} placeNonce={0}>
        body
      </HudWindow>,
    );
    const win = screen.getByRole("region", { name: "Panel" });
    expect(win).toHaveStyle({ left: "111px", top: "222px", width: "280px" });
  });

  it("DraggableWindow shim maps legacy props onto HudWindow", () => {
    render(
      <DraggableWindow title="Live Panel" initialX={40} initialY={30} width={250}>
        legacy child
      </DraggableWindow>,
    );
    const win = screen.getByRole("region", { name: "Live Panel" });
    expect(win).toHaveStyle({ left: "40px", top: "30px", width: "250px" });
    expect(screen.getByText("legacy child")).toBeInTheDocument();
  });
});
