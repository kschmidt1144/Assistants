/** Prompt templates — routed to the live model (as a chat turn) or to deep analysis (screenshot). */

export interface PromptTemplate {
  id: string;
  label: string;
  prompt: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  { id: "review", label: "Review", prompt: "Review the code on screen and point out bugs, risks, and improvements." },
  { id: "explain", label: "Explain", prompt: "Explain what the code on screen does, clearly and concisely." },
  { id: "fix", label: "Fix error", prompt: "Identify the error shown on screen and give a concrete fix." },
  { id: "optimize", label: "Optimize", prompt: "Suggest performance or readability optimizations for the code on screen." },
  { id: "tests", label: "Tests", prompt: "Suggest unit tests for the code on screen, with example test code." },
  { id: "refactor", label: "Refactor", prompt: "Propose a cleaner refactor of the code on screen." },
  { id: "security", label: "Security", prompt: "Audit the code on screen for security issues and how to address them." },
  { id: "docs", label: "Docs", prompt: "Write documentation / docstrings for the code on screen." },
];
