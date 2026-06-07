/** Markdown renderer with GFM + code blocks that have copy + collapse (syntax highlight: later). */

import { useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return extractText(props?.children);
  }
  return "";
}

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const isBlock = typeof className === "string" && className.startsWith("language-");
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (!isBlock) {
    return <code className={className}>{children}</code>;
  }

  const text = extractText(children);
  const lines = text.replace(/\n$/, "").split("\n").length;
  const language = className?.replace("language-", "") ?? "";

  const copy = () => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, overflow: "hidden", margin: "8px 0" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 10px",
          background: "rgba(255,255,255,0.05)",
          fontSize: 12,
          opacity: 0.85,
        }}
      >
        <span>{language || "code"} · {lines} {lines === 1 ? "line" : "lines"}</span>
        <span>
          {lines > 8 && (
            <button type="button" onClick={() => setCollapsed((c) => !c)} style={ctrlBtn}>
              {collapsed ? "expand" : "collapse"}
            </button>
          )}
          <button type="button" onClick={copy} style={ctrlBtn}>
            {copied ? "copied" : "copy"}
          </button>
        </span>
      </div>
      {!collapsed && (
        <pre style={{ margin: 0, padding: 12, overflow: "auto", fontSize: 13 }}>
          <code className={className}>{children}</code>
        </pre>
      )}
    </div>
  );
}

const ctrlBtn = {
  background: "transparent",
  border: "none",
  color: "inherit",
  cursor: "pointer",
  opacity: 0.8,
  fontSize: 12,
  marginLeft: 8,
} as const;

const components: Components = { code: CodeBlock as Components["code"] };

export interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </Markdown>
  );
}
