import { describe, it, expect } from "vitest";
import { PROMPT_TEMPLATES } from "./templates";

describe("templates", () => {
  it("COD-U-07: has exactly 8 templates with unique ids and non-empty prompts", () => {
    expect(PROMPT_TEMPLATES).toHaveLength(8);
    
    const ids = new Set<string>();
    for (const t of PROMPT_TEMPLATES) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.prompt.length).toBeGreaterThan(0);
      ids.add(t.id);
    }
    
    // Ensure all ids are unique
    expect(ids.size).toBe(8);
  });
});
