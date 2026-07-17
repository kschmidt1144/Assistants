import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { clockOf, type Entry } from "../lib/format";

export interface TranscriptViewProps {
  entries: Entry[];
  interim: string;
  currentSpeaker: string;
  /** Optional control rendered in the section header (e.g. pop-out toggle). */
  headerExtra?: ReactNode;
}

export function TranscriptView({ entries, interim, currentSpeaker, headerExtra }: TranscriptViewProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, interim]);

  return (
    <div className="col">
      <h3>
        Transcript{currentSpeaker ? <span className="head-detail"> · speaking: {currentSpeaker}</span> : ""}
        {headerExtra && <span className="spacer" />}
        {headerExtra}
      </h3>
      <div className="scroll" ref={ref}>
        {entries.length === 0 && !interim && (
          <div className="hint">Press ● Record to start live transcription (Chrome).</div>
        )}
        {entries.map((e, i) => (
          <div className="entry" key={i}>
            <span className="ts">{clockOf(e.ts)}</span>
            <span className="speaker">{e.speaker}:</span>
            <span>{e.text}</span>
          </div>
        ))}
        {interim && (
          <div className="entry interim">
            <span className="speaker">{currentSpeaker || "…"}:</span> {interim}
          </div>
        )}
      </div>
    </div>
  );
}
