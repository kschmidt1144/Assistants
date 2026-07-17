/**
 * Quick-actions registry — the common coding-assistant tasks, defined once and
 * consumed by both the control-bar launcher (the ⚡ Actions palette) and the
 * global keyboard shortcuts. Keeping them in one place means a button and its
 * hotkey can never drift apart.
 */

import type { PromptTemplate } from "./templates";

/** Default prompt for the generic "analyze the whole screen" action. */
export const ANALYZE_SCREEN_PROMPT =
  "Analyze the code on screen: what it does, plus any bugs, risks, or improvements.";

export type QuickActionGroup = "Capture" | "Tasks";

export interface QuickAction {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  /** Single-key global shortcut (also shown in the palette). */
  shortcut?: string;
  group: QuickActionGroup;
  run: () => void;
  /** Greyed-out + non-runnable (e.g. no feed yet). */
  disabled?: boolean;
}

export interface QuickActionsCtx {
  hasFeed: boolean;
  analyzeScreen: () => void;
  analyzeRegion: () => void;
  ocr: () => void;
  runTemplate: (t: PromptTemplate) => void;
  templates: PromptTemplate[];
}

/** Build the ordered action list for the current context. */
export function buildQuickActions(ctx: QuickActionsCtx): QuickAction[] {
  const off = !ctx.hasFeed;
  const capture: QuickAction[] = [
    {
      id: "analyze-screen",
      label: "Analyze screen",
      hint: "Send the whole frame to the model",
      icon: "🔬",
      shortcut: "A",
      group: "Capture",
      run: ctx.analyzeScreen,
      disabled: off,
    },
    {
      id: "analyze-region",
      label: "Analyze region",
      hint: "Drag to select an area to analyze",
      icon: "⬚",
      shortcut: "R",
      group: "Capture",
      run: ctx.analyzeRegion,
      disabled: off,
    },
    {
      id: "ocr",
      label: "Extract text (OCR)",
      hint: "Read code / text off the screen",
      icon: "🔤",
      shortcut: "O",
      group: "Capture",
      run: ctx.ocr,
      disabled: off,
    },
  ];

  const tasks: QuickAction[] = ctx.templates.map((t) => ({
    id: `tpl-${t.id}`,
    label: t.label,
    hint: t.prompt,
    icon: "⌨",
    group: "Tasks",
    run: () => ctx.runTemplate(t),
    disabled: off,
  }));

  return [...capture, ...tasks];
}

/** Map single-key shortcuts → action, for the global hotkey handler. */
export function shortcutMap(actions: QuickAction[]): Map<string, QuickAction> {
  const m = new Map<string, QuickAction>();
  for (const a of actions) if (a.shortcut) m.set(a.shortcut.toLowerCase(), a);
  return m;
}
