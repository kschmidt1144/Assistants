import { useCallback, useEffect, useRef, useState } from "react";
import { AudioWorkletCapture, SpeechTranscription } from "@assistants/core-web";
import { ControlBar } from "./components/ControlBar";
import { EnrollModal } from "./components/EnrollModal";
import { NotesPanel } from "./components/NotesPanel";
import { TranscriptView } from "./components/TranscriptView";
import { api, type ActionItem, type MeetingRow, type VoiceProfile } from "./lib/api";
import { download, elapsed, entriesToText, type Entry } from "./lib/format";

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

      <div className="main">
        <TranscriptView entries={entries} interim={interim} currentSpeaker={currentSpeaker} />
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
        />
      </div>

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
