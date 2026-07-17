import { MarkdownRenderer } from "@assistants/core-web";
import type { ReactNode } from "react";
import type { ActionItem } from "../lib/api";

/** Small "AI output" mark for generated note sections. */
const Sparkle = (
  <svg className="sparkle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" />
  </svg>
);

export interface NotesPanelProps {
  hasTranscript: boolean;
  busy: string | null;
  summary: string;
  actionItems: ActionItem[];
  cleaned: string;
  answer: string;
  question: string;
  setQuestion: (v: string) => void;
  onSummary: () => void;
  onActions: () => void;
  onClean: () => void;
  onAsk: () => void;
  onUseSelection: () => void;
  /** Optional control rendered in the section header (e.g. pop-out toggle). */
  headerExtra?: ReactNode;
}

export function NotesPanel(props: NotesPanelProps) {
  const disabled = !props.hasTranscript || props.busy !== null;
  return (
    <div className="col notes">
      <h3>
        Notes{props.busy ? ` · ${props.busy}…` : ""}
        {props.headerExtra && <span className="spacer" />}
        {props.headerExtra}
      </h3>
      <div className="scroll">
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          <button className="btn" disabled={disabled} onClick={props.onSummary}>Summary</button>
          <button className="btn" disabled={disabled} onClick={props.onActions}>Action items</button>
          <button className="btn" disabled={disabled} onClick={props.onClean}>Clean</button>
        </div>

        {props.summary && (
          <div className="notes-block">
            <h4>{Sparkle}Summary</h4>
            <MarkdownRenderer content={props.summary} />
          </div>
        )}

        {props.actionItems.length > 0 && (
          <div className="notes-block">
            <h4>{Sparkle}Action items</h4>
            {props.actionItems.map((a, i) => (
              <div className="action-item" key={i}>
                {a.action} <span className="owner">— {a.owner}</span>
              </div>
            ))}
          </div>
        )}

        {props.cleaned && (
          <div className="notes-block">
            <h4>{Sparkle}Cleaned transcript</h4>
            <MarkdownRenderer content={props.cleaned} />
          </div>
        )}

        <div className="notes-block">
          <h4>Ask</h4>
          <div className="ask-row">
            <input
              className="hud-input"
              value={props.question}
              placeholder="Ask about this meeting…"
              onChange={(e) => props.setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") props.onAsk();
              }}
            />
            <button className="btn" disabled={disabled} onClick={props.onAsk}>Ask</button>
          </div>
          <button className="btn" style={{ marginTop: 6 }} onClick={props.onUseSelection}>
            Use selected text
          </button>
          {props.answer && (
            <div className="notes-block" style={{ marginTop: 8 }}>
              <MarkdownRenderer content={props.answer} />
            </div>
          )}
        </div>

        {!props.hasTranscript && <div className="hint">Record some conversation first.</div>}
      </div>
    </div>
  );
}
