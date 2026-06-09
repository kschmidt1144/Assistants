import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CaptureCanvas, type CaptureCanvasHandle } from "./CaptureCanvas";
import React from "react";

describe("CaptureCanvas", () => {
  it("COD-C-11: region drag >=4x4 triggers onRegion, clear wipes", () => {
    const handleRegion = vi.fn();
    const ref = React.createRef<CaptureCanvasHandle>();
    
    // Stub getContext
    const mockClearRect = vi.fn();
    const mockGetContext = vi.fn().mockReturnValue({ clearRect: mockClearRect });
    HTMLCanvasElement.prototype.getContext = mockGetContext as any;

    const { container } = render(
      <CaptureCanvas
        ref={ref}
        videoW={100}
        videoH={100}
        boxW={100}
        boxH={100}
        tool="region"
        onRegion={handleRegion}
      />
    );

    const div = container.firstChild as HTMLDivElement;
    
    // Provide a mocked getBoundingClientRect so math works out
    vi.spyOn(div, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0 } as DOMRect);
    div.setPointerCapture = vi.fn();
    div.releasePointerCapture = vi.fn();

    // Drag from 10,10 to 20,20 (10x10)
    fireEvent.pointerDown(div, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(div, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(div, { pointerId: 1, clientX: 20, clientY: 20 });

    expect(handleRegion).toHaveBeenCalledTimes(1);
    expect(handleRegion).toHaveBeenCalledWith({ x: 10, y: 10, w: 10, h: 10 });

    // Drag <4x4 should be ignored
    handleRegion.mockReset();
    fireEvent.pointerDown(div, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(div, { pointerId: 2, clientX: 12, clientY: 12 });
    fireEvent.pointerUp(div, { pointerId: 2, clientX: 12, clientY: 12 });
    
    expect(handleRegion).not.toHaveBeenCalled();

    // test clear()
    expect(ref.current).not.toBeNull();
    ref.current?.clear();
    expect(mockClearRect).toHaveBeenCalledWith(0, 0, 100, 100);
  });
});
