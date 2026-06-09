import { describe, it, expect } from "vitest";
import React from "react";
import { extractText } from "./MarkdownRenderer";

describe("MarkdownRenderer extractText", () => {
  it("WEB-U-04: extractText flattens React nodes to pure string", () => {
    // null/undefined/boolean
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
    expect(extractText(true)).toBe("");
    expect(extractText(false)).toBe("");
    
    // strings and numbers
    expect(extractText("hello")).toBe("hello");
    expect(extractText(123)).toBe("123");
    
    // array
    expect(extractText(["a", " ", "b", 42])).toBe("a b42");
    
    // React element
    const element = React.createElement("div", {}, 
      React.createElement("span", {}, "Nested"),
      " Text"
    );
    expect(extractText(element)).toBe("Nested Text");
  });
});
