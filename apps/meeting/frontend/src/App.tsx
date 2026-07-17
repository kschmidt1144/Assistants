import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AudioWorkletCapture, HudWindow, SpeechTranscription } from "@assistants/core-web";
import { ControlBar } from "./components/ControlBar";
import { EnrollModal } from "./components/EnrollModal";
import { NotesPanel } from "./components/NotesPanel";
import { TranscriptView } from "./components/TranscriptView";
import { api, type ActionItem, type MeetingRow, type VoiceProfile } from "./lib/api";
import { download, elapsed, entriesToText, type Entry } from "./lib/format";

// ── pop-out persistence ────────────────────────────────────────────────────
function loadPop(key: string): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(key) === "1";
}
function storePop(key: string, on: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* private mode — non-fatal */
  }
}
const POP_TRANSCRIPT = "meeting.pop.transcript";
const POP_NOTES = "meeting.pop.notes";

// ── header pop-out / dock toggle buttons ───────────────────────────────────
const ICON_POP_OUT = "M14 4h6v6M20 4l-8 8M9 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4";
const ICON_DOCK_IN = "M4 14h6v6M10 14l-8 8M15 5h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-4";
function PopGlyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function App() {
  const speechRef = useRef<SpeechTranscription | null>(null);
  const audioRef = useRef<AudioWorkletCapture | null>(null);
  const speakerRef = useRef("");

  const [live, setLive] = useState(false);
  const [sysAudio, setSysAudio] = useState(false);
  const [level, setLevel] = useState(0);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [interim, setInterim] = useState("");
  const [currentSpeaker, setCurrentSpeaker] = useState("");

  const [topic, setTopic] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [showProfiles, setShowProfiles] = useState(false);

  // Poppable panels: docked-in-grid by default, floatable into HudWindows.
  const [transcriptPopped, setTranscriptPopped] = useState(() => loadPop(POP_TRANSCRIPT));
  const [notesPopped, setNotesPopped] = useState(() => loadPop(POP_NOTES));
  const setTranscriptPop = useCallback((on: boolean) => {
    storePop(POP_TRANSCRIPT, on);
    setTranscriptPopped(on);
  }, []);
  const setNotesPop = useCallback((on: boolean) => {
    storePop(POP_NOTES, on);
    setNotesPopped(on);
  }, []);

  const [summary, setSummary] = useState("");
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [cleaned, setCleaned] = useState("");
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const speechSupported = SpeechTranscription.isSupported();

  const refreshMeetings = useCallback(async () => {
    try {
      setMeetings(await api.listMeetings());
    } catch {
      /* backend not up yet */
    }
  }, []);
  const refreshProfiles = useCallback(async () => {
    try {
      setProfiles(await api.voiceProfiles());
    } catch {
      /* backend not up yet */
    }
  }, []);

  useEffect(() => {
    void refreshMeetings();
    void refreshProfiles();
  }, [refreshMeetings, refreshProfiles]);

  // timer
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setElapsedSec(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [live, startTime]);

  // ── live recording: Web Speech transcription + speaker-ID segments ───────────
  const startLive = useCallback(async () => {
    if (!SpeechTranscription.isSupported()) {
      alert("Web Speech API not supported — use Chrome.");
      return;
    }
    const sp = new SpeechTranscription();
    speechRef.current = sp;
    sp.start({
      onResult: ({ text, isFinal }) => {
        if (isFinal) {
          const trimmed = text.trim();
          if (trimmed) {
            setEntries((es) => [
              ...es,
              { ts: Date.now() / 1000, speaker: speakerRef.current || "Speaker", text: trimmed },
            ]);
          }
          setInterim("");
        } else {
          setInterim(text);
        }
      },
      onError: (e) => console.warn("speech:", e),
    });

    const cap = new AudioWorkletCapture();
    audioRef.current = cap;
    try {
      await cap.start({
        captureSystemAudio: sysAudio,
        chunkSize: 40000, // ~2.5s segments for speaker-ID
        onLevel: setLevel,
        onAudio: (b64) => {
          void api
            .identifySpeaker(b64)
            .then((r) => {
              speakerRef.current = r.speaker;
              setCurrentSpeaker(r.speaker);
            })
            .catch(() => undefined);
        },
      });
    } catch (e) {
      console.warn("mic:", (e as Error).message);
    }

    setStartTime(Date.now());
    setElapsedSec(0);
    setLive(true);
  }, [sysAudio]);

  const stopLive = useCallback(() => {
    speechRef.current?.stop();
    speechRef.current = null;
    audioRef.current?.stop();
    audioRef.current = null;
    setLevel(0);
    setLive(false);
  }, []);

  useEffect(() => () => stopLive(), [stopLive]);

  // ── notes (Claude) ───────────────────────────────────────────────────────────
  const transcriptText = useCallback(
    () => entries.map((e) => `${e.speaker}: ${e.text}`).join("\n"),
    [entries],
  );

  const runOp = useCallback(
    async (name: string, fn: () => Promise<void>) => {
      setBusy(name);
      try {
        await fn();
      } catch (e) {
        alert(`${name} failed: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const onSummary = () => void runOp("summary", async () => setSummary((await api.summarize(transcriptText())).summary));
  const onActions = () => void runOp("action items", async () => setActionItems((await api.actionItems(transcriptText())).items));
  const onClean = () => void runOp("clean", async () => setCleaned((await api.clean(transcriptText())).cleaned));
  const onAsk = () => {
    if (!question.trim()) return;
    void runOp("ask", async () => setAnswer((await api.ask(transcriptText(), question)).answer));
  };
  const onUseSelection = () => {
    const sel = window.getSelection?.()?.toString();
    if (sel) setQuestion(sel);
  };

  // ── persistence ──────────────────────────────────────────────────────────────
  const onSave = useCallback(async () => {
    setSaving(true);
    try {
      let id = meetingId;
      if (!id) {
        id = (await api.createMeeting(topic || null)).id;
        setMeetingId(id);
      } else {
        await api.updateMeeting(id, { title: topic || undefined });
      }
      const fresh = entries.slice(savedCount);
      if (fresh.length) {
        await api.appendEntries(id, fresh.map((e) => ({ speaker: e.speaker, text: e.text, ts: e.ts })));
        setSavedCount(entries.length);
      }
      if (summary) await api.updateMeeting(id, { summary });
      await refreshMeetings();
    } catch (e) {
      alert(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [meetingId, topic, entries, savedCount, summary, refreshMeetings]);

  const onLoad = useCallback(async (id: string) => {
    try {
      const d = await api.getMeeting(id);
      setEntries(d.entries.map((e) => ({ ts: e.ts, speaker: e.speaker || "Speaker", text: e.text })));
      setMeetingId(id);
      setSavedCount(d.entries.length);
      setTopic(d.session.title || "");
      setSummary(d.session.metadata?.summary || "");
      setActionItems([]);
      setCleaned("");
      setAnswer("");
    } catch (e) {
      alert(`Load failed: ${(e as Error).message}`);
    }
  }, []);

  const onExport = useCallback(() => {
    const body =
      `# ${topic || "Meeting"}\n\n` +
      entriesToText(entries) +
      (summary ? `\n\n## Summary\n\n${summary}` : "");
    download(`meeting-${Math.floor(Date.now() / 1000)}.md`, body);
  }, [topic, entries, summary]);

  // ── profiles ─────────────────────────────────────────────────────────────────
  const onEnroll = useCallback(
    async (name: string, samples: string[]) => {
      await api.enrollSpeaker(name, samples);
      await refreshProfiles();
    },
    [refreshProfiles],
  );
  const onDeleteProfile = useCallback(
    async (name: string) => {
      await api.deleteProfile(name);
      await refreshProfiles();
    },
    [refreshProfiles],
  );

  return (
    <div className="app">
      <ControlBar
        speechSupported={speechSupported}
        live={live}
        onToggleLive={() => (live ? stopLive() : void startLive())}
        sysAudio={sysAudio}
        onToggleSysAudio={() => setSysAudio((s) => !s)}
        level={level}
        topic={topic}
        setTopic={setTopic}
        elapsedStr={elapsed(elapsedSec)}
        saving={saving}
        onSave={() => void onSave()}
        onExport={onExport}
        meetings={meetings}
        onLoad={(id) => void onLoad(id)}
        onOpenProfiles={() => setShowProfiles(true)}
      />

      {(() => {
        const popOutBtn = (label: string, onClick: () => void): ReactNode => (
          <button type="button" className="pop-btn" aria-label={label} title={label} onClick={onClick}>
            <PopGlyph d={ICON_POP_OUT} />
          </button>
        );
        const dockInBtn = (label: string, onClick: () => void): ReactNode => (
          <button type="button" className="pop-btn" aria-label={label} title={label} onClick={onClick}>
            <PopGlyph d={ICON_DOCK_IN} />
          </button>
        );

        const transcript = (extra: ReactNode) => (
          <TranscriptView entries={entries} interim={interim} currentSpeaker={currentSpeaker} headerExtra={extra} />
        );
        const notes = (extra: ReactNode) => (
          <NotesPanel
            hasTranscript={entries.length > 0}
            busy={busy}
            summary={summary}
            actionItems={actionItems}
            cleaned={cleaned}
            answer={answer}
            question={question}
            setQuestion={setQuestion}
            onSummary={onSummary}
            onActions={onActions}
            onClean={onClean}
            onAsk={onAsk}
            onUseSelection={onUseSelection}
            headerExtra={extra}
          />
        );

        const solo = transcriptPopped !== notesPopped;

        return (
          <>
            <div className={`main${solo ? " solo" : ""}`}>
              {!transcriptPopped && transcript(popOutBtn("Pop out transcript", () => setTranscriptPop(true)))}
              {!notesPopped && notes(popOutBtn("Pop out notes", () => setNotesPop(true)))}
            </div>

            {transcriptPopped && (
              <HudWindow
                id="meeting.transcript"
                title="Transcript"
                statusPill={live ? { label: "Live", tone: "live" } : undefined}
                defaultPos={{ x: 24, y: 80 }}
                defaultSize={{ w: 520, h: 420 }}
                headerActions={dockInBtn("Dock transcript", () => setTranscriptPop(false))}
                onClose={() => setTranscriptPop(false)}
              >
                {transcript(null)}
              </HudWindow>
            )}

            {notesPopped && (
              <HudWindow
                id="meeting.notes"
                title="Notes"
                statusPill={busy ? { label: busy, tone: "neutral" } : undefined}
                defaultPos={{ x: Math.max(24, window.innerWidth - 460), y: 80 }}
                defaultSize={{ w: 420, h: 420 }}
                headerActions={dockInBtn("Dock notes", () => setNotesPop(false))}
                onClose={() => setNotesPop(false)}
              >
                {notes(null)}
              </HudWindow>
            )}
          </>
        );
      })()}

      {showProfiles && (
        <EnrollModal
          profiles={profiles}
          onClose={() => setShowProfiles(false)}
          onEnroll={onEnroll}
          onDelete={onDeleteProfile}
        />
      )}
    </div>
  );
}
