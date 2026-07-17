import { describe, it, expect, vi } from "vitest";
import { buildQuickActions, shortcutMap, ANALYZE_SCREEN_PROMPT, type QuickActionsCtx } from "./actions";
import { PROMPT_TEMPLATES } from "./templates";

function ctx(over: Partial<QuickActionsCtx> = {}): QuickActionsCtx {
  return {
    hasFeed: true,
    analyzeScreen: vi.fn(),
    analyzeRegion: vi.fn(),
    ocr: vi.fn(),
    runTemplate: vi.fn(),
    templates: PROMPT_TEMPLATES,
    ...over,
  };
}

describe("quick actions", () => {
  it("exposes A/R/O capture actions plus one task per template", () => {
    const actions = buildQuickActions(ctx());
    const get = (id: string) => actions.find((a) => a.id === id)!;

    expect(get("analyze-screen").shortcut).toBe("A");
    expect(get("analyze-region").shortcut).toBe("R");
    expect(get("ocr").shortcut).toBe("O");
    for (const t of PROMPT_TEMPLATES) {
      expect(get(`tpl-${t.id}`).group).toBe("Tasks");
    }
  });

  it("run() dispatches to the matching handler", () => {
    const c = ctx();
    const actions = buildQuickActions(c);
    const get = (id: string) => actions.find((a) => a.id === id)!;

    get("analyze-screen").run();
    get("analyze-region").run();
    get("ocr").run();
    get("tpl-review").run();

    expect(c.analyzeScreen).toHaveBeenCalledTimes(1);
    expect(c.analyzeRegion).toHaveBeenCalledTimes(1);
    expect(c.ocr).toHaveBeenCalledTimes(1);
    expect(c.runTemplate).toHaveBeenCalledWith(PROMPT_TEMPLATES.find((t) => t.id === "review"));
  });

  it("disables every action when there is no feed", () => {
    const actions = buildQuickActions(ctx({ hasFeed: false }));
    expect(actions.every((a) => a.disabled)).toBe(true);
  });

  it("shortcutMap keys actions by their lowercased shortcut", () => {
    const map = shortcutMap(buildQuickActions(ctx()));
    expect(map.get("a")?.id).toBe("analyze-screen");
    expect(map.get("r")?.id).toBe("analyze-region");
    expect(map.get("o")?.id).toBe("ocr");
    expect(map.has("z")).toBe(false); // templates carry no single-key shortcut
  });

  it("has a non-empty analyze-screen prompt", () => {
    expect(ANALYZE_SCREEN_PROMPT.length).toBeGreaterThan(0);
  });
});
