import { MarkdownRenderer } from "@assistants/core-web";
import type { ActionItem } from "../lib/api";

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
}

export function NotesPanel(props: NotesPanelProps) {
  const disabled = !props.hasTranscript || props.busy !== null;
  return (
    <div className="col notes">
      <h3>Notes{props.busy ? ` · ${props.busy}…` : ""}</h3>
      <div className="scroll">
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          <button className="btn" disabled={disabled} onClick={props.onSummary}>Summary</button>
          <button className="btn" disabled={disabled} onClick={props.onActions}>Action items</button>
          <button className="btn" disabled={disabled} onClick={props.onClean}>Clean</button>
        </div>

        {props.summary && (
          <div className="notes-block">
            <h4>Summary</h4>
            <MarkdownRenderer content={props.summary} />
          </div>
        )}

        {props.actionItems.length > 0 && (
          <div className="notes-block">
            <h4>Action items</h4>
            {props.actionItems.map((a, i) => (
              <div className="action-item" key={i}>
                {a.action} <span className="owner">— {a.owner}</span>
              </div>
            ))}
          </div>
        )}

        {props.cleaned && (
          <div className="notes-block">
            <h4>Cleaned transcript</h4>
            <MarkdownRenderer content={props.cleaned} />
          </div>
        )}

        <div className="notes-block">
          <h4>Ask</h4>
          <div className="ask-row">
            <input
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
