import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { App } from "./App";
import { api } from "./lib/api";
import { RealtimeClient } from "@assistants/core-web";
import React from "react";

// Mock the API
vi.mock("./lib/api", () => ({
  api: {
    analyze: vi.fn(),
    ocr: vi.fn(),
  },
}));

// Mock core-web
const mockSendText = vi.fn();
const mockConnect = vi.fn();
const mockSendConfig = vi.fn();

vi.mock("@assistants/core-web", () => {
  return {
    RealtimeClient: vi.fn().mockImplementation(function() {
      return {
        connect: mockConnect,
        sendConfig: mockSendConfig,
        sendText: mockSendText,
        close: vi.fn(),
      };
    }),
    VideoCapture: vi.fn().mockImplementation(function() {
      return { 
        stop: vi.fn(),
        startCamera: vi.fn().mockResolvedValue({}),
        startScreen: vi.fn().mockResolvedValue({}),
        kind: "camera" 
      };
    }),
    AudioPlayback: vi.fn().mockImplementation(function() {
      return { stop: vi.fn(), enqueue: vi.fn() };
    }),
    AudioWorkletCapture: vi.fn().mockImplementation(function() {
      return { stop: vi.fn(), start: vi.fn() };
    }),
    DraggableWindow: ({ children }: any) => <div data-testid="draggable-window">{children}</div>,
    MarkdownRenderer: ({ content }: any) => <div>{content}</div>,
  };
});

// Mock video list
(vi.mocked(await import("@assistants/core-web")).VideoCapture as any).listVideoInputs = vi.fn().mockResolvedValue([]);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.alert = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  });

  it("COD-C-10: template routing (Live on->sendText, Live off->analyze) & pinned context", async () => {
    localStorage.setItem("coding.pinnedContext", "pinned data");

    await act(async () => {
      render(<App />);
    });

    // Start a feed to enable the Live button
    const cameraBtn = screen.getByText("📷 Camera");
    await act(async () => {
      fireEvent.click(cameraBtn);
    });

    // Start live mode
    const toggleLiveBtn = screen.getByText("⚡ Live");
    fireEvent.click(toggleLiveBtn);
    
    // We should have created a RealtimeClient and connected
    expect(RealtimeClient).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Trigger a template
    const templateSelect = screen.getByText("⌨ Templates…").closest("select") as HTMLSelectElement;
    fireEvent.change(templateSelect, { target: { value: "review" } });
    
    // Because Live is ON, it should sendText instead of runAnalyze
    expect(mockSendText).toHaveBeenCalledTimes(1);
    expect(mockSendText).toHaveBeenCalledWith(expect.stringContaining("Review the code"));
    expect(api.analyze).not.toHaveBeenCalled();

    // Turn off live
    fireEvent.click(toggleLiveBtn); // "Live" button again

    // Trigger a template again
    fireEvent.change(templateSelect, { target: { value: "review" } });

    // Because Live is OFF, it should runAnalyze
    expect(api.analyze).toHaveBeenCalledTimes(1);
    expect(api.analyze).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("Review the code"),
      context: "pinned data",
      role: "reason_deep", // default
    }));
  });
});
