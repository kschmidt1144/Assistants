/**
 * Interview Practice — a spoken mock interview against Gemini Live, graded by Claude.
 *
 * Turn model: the interviewer's speech arrives as `text` deltas (output transcription) + `audio`;
 * `turnComplete` means the question has been asked and the answer clock starts. The candidate's
 * mic speech comes back as `transcript` fragments. When interviewer text resumes, the candidate's
 * answer is closed and its duration recorded — that timing feeds the ≤90s discipline in the debrief.
 */

import { AudioPlayback, AudioWorkletCapture, MarkdownRenderer, RealtimeClient } from "@assistants/core-web";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type InterviewPackInfo, type TranscriptEntry } from "../lib/api";

type Phase = "idle" | "connecting" | "live" | "debriefing" | "done";

const ANSWER_TARGET_S = 90;

export function InterviewPractice() {
  const [packs, setPacks] = useState<InterviewPackInfo[]>([]);
  const [packName, setPackName] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [level, setLevel] = useState(0);
  const [answerSeconds, setAnswerSeconds] = useState<number | null>(null);
  const [scorecard, setScorecard] = useState<string>("");
  const [savedPath, setSavedPath] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [micOn, setMicOn] = useState(true);
  const micOnRef = useRef(true);

  const rtRef = useRef<RealtimeClient | null>(null);
  const captureRef = useRef<AudioWorkletCapture | null>(null);
  const playbackRef = useRef<AudioPlayback | null>(null);
  const entriesRef = useRef<TranscriptEntry[]>([]);
  const speakerRef = useRef<"interviewer" | "candidate" | null>(null);
  const answerStartRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number>(0);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void api
      .interviewPacks()
      .then((p) => {
        setPacks(p);
        if (p.length > 0) setPackName(p[0].name);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  // Answer clock: runs from the interviewer finishing a question until they speak again.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => {
      setAnswerSeconds(
        answerStartRef.current === null ? null : (Date.now() - answerStartRef.current) / 1000,
      );
    }, 500);
    return () => clearInterval(t);
  }, [phase]);

  const syncEntries = () => setEntries([...entriesRef.current]);

  const closeCandidateAnswer = () => {
    if (answerStartRef.current !== null && speakerRef.current === "candidate") {
      const last = entriesRef.current[entriesRef.current.length - 1];
      if (last?.speaker === "candidate") {
        last.seconds = (Date.now() - answerStartRef.current) / 1000;
      }
    }
    answerStartRef.current = null;
  };

  const stopMedia = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    rtRef.current?.close();
    rtRef.current = null;
  }, []);

  useEffect(() => () => stopMedia(), [stopMedia]);

  const start = async () => {
    if (!packName) return;
    setError("");
    setEntries([]);
    setScorecard("");
    setSavedPath("");
    entriesRef.current = [];
    speakerRef.current = null;
    answerStartRef.current = null;
    setPhase("connecting");
    try {
      const pack = await api.interviewPack(packName);
      playbackRef.current = new AudioPlayback();

      const rt = new RealtimeClient(
        `ws://${window.location.host}/ws/interview`,
        {
          onStatus: () => setPhase("live"),
          onText: (delta) => {
            if (speakerRef.current !== "interviewer") {
              closeCandidateAnswer();
              entriesRef.current.push({ speaker: "interviewer", text: delta });
              speakerRef.current = "interviewer";
            } else {
              entriesRef.current[entriesRef.current.length - 1].text += delta;
            }
            syncEntries();
          },
          onTranscript: (text) => {
            if (speakerRef.current !== "candidate") {
              entriesRef.current.push({ speaker: "candidate", text });
              speakerRef.current = "candidate";
            } else {
              entriesRef.current[entriesRef.current.length - 1].text += text;
            }
            syncEntries();
          },
          onAudio: (b64) => playbackRef.current?.enqueue(b64),
          onTurnComplete: () => {
            // Question asked — the candidate's answer clock starts now.
            speakerRef.current = null;
            answerStartRef.current = Date.now();
          },
          onError: (msg) => setError(msg),
          onClose: () => setPhase((p) => (p === "live" || p === "connecting" ? "idle" : p)),
        },
        { reconnect: false },
      );
      rtRef.current = rt;
      rt.connect();
      rt.sendConfig(pack.system);
      rt.sendText("[BEGIN_INTERVIEW]");

      micOnRef.current = true;
      setMicOn(true);
      const capture = new AudioWorkletCapture();
      captureRef.current = capture;
      await capture.start({
        onAudio: (b64) => {
          if (micOnRef.current) rtRef.current?.sendAudio(b64);
        },
        onLevel: (rms) => setLevel(micOnRef.current ? rms : 0),
      });
      sessionStartRef.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      stopMedia();
      setPhase("idle");
    }
  };

  /** Cut off the interviewer's queued voice (barge-in): drop the playback queue, keep the session. */
  const interrupt = () => {
    playbackRef.current?.stop();
    playbackRef.current = new AudioPlayback();
  };

  const toggleMic = () => {
    micOnRef.current = !micOnRef.current;
    setMicOn(micOnRef.current);
    if (!micOnRef.current) setLevel(0);
  };

  /** [CONTROL: …] messages are tool buttons, not candidate speech — the preamble explains them. */
  const control = (cmd: "repeat" | "skip" | "pause") => {
    if (cmd !== "pause") interrupt();
    rtRef.current?.sendText(`[CONTROL: ${cmd}]`);
  };

  /** Abandon this run and immediately begin a fresh one with the same pack. */
  const restart = () => {
    stopMedia();
    void start();
  };

  /** End the session without grading it. */
  const discard = () => {
    stopMedia();
    answerStartRef.current = null;
    setPhase("idle");
  };

  const end = async () => {
    closeCandidateAnswer();
    const duration = (Date.now() - sessionStartRef.current) / 1000;
    stopMedia();
    const transcript = entriesRef.current.filter((e) => e.text.trim());
    if (transcript.length === 0) {
      setPhase("idle");
      return;
    }
    setPhase("debriefing");
    try {
      const res = await api.interviewDebrief({ pack: packName, transcript, duration_seconds: duration });
      setScorecard(res.scorecard);
      setSavedPath(res.saved);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("done");
    }
  };

  const timerClass =
    answerSeconds === null ? "" : answerSeconds > ANSWER_TARGET_S ? "over" : answerSeconds > 60 ? "warn" : "ok";

  return (
    <div className="maxw interview">
      <h2>🎤 Interview Practice</h2>
      {error && <div className="error">{error}</div>}

      {(phase === "idle" || phase === "connecting") && (
        <div className="row">
          <select className="btn" value={packName} onChange={(e) => setPackName(e.target.value)} disabled={phase === "connecting"}>
            {packs.map((p) => (
              <option key={p.name} value={p.name}>{p.title}</option>
            ))}
          </select>
          <button className="btn primary" onClick={() => void start()} disabled={!packName || phase === "connecting"}>
            {phase === "connecting" ? "Connecting…" : "Start interview"}
          </button>
          {packs.length === 0 && !error && <span className="hint">no interview packs found</span>}
        </div>
      )}

      {phase === "live" && (
        <div className="row live-bar">
          <span className="pill live">● LIVE</span>
          <div className="meter"><div className="meter-fill" style={{ width: `${Math.min(100, level * 300)}%` }} /></div>
          {answerSeconds !== null && (
            <span className={`pill timer ${timerClass}`}>answer {Math.floor(answerSeconds)}s / {ANSWER_TARGET_S}s</span>
          )}
          <div className="spacer" />
          <button className={`btn ${micOn ? "" : "active"}`} onClick={toggleMic} title="Stop/resume sending your microphone">
            {micOn ? "Mute mic" : "Unmute mic"}
          </button>
          <button className="btn" onClick={() => control("repeat")} title="Ask the interviewer to restate the question">Repeat Q</button>
          <button className="btn" onClick={() => control("skip")} title="Skip to the next question">Skip Q</button>
          <button className="btn" onClick={() => control("pause")} title="Interviewer waits until you speak again">Hold on</button>
          <button className="btn" onClick={interrupt} title="Stop the interviewer's voice (barge in)">Cut off voice</button>
          <button className="btn" onClick={restart} title="Throw this run away and start over">Restart</button>
          <button className="btn" onClick={discard} title="End without grading">Discard</button>
          <button className="btn danger" onClick={() => void end()}>End → debrief</button>
        </div>
      )}

      {entries.length > 0 && (
        <div className="transcript">
          {entries.map((e, i) => (
            <div key={i} className={`turn ${e.speaker}`}>
              <span className="who">{e.speaker === "interviewer" ? "Interviewer" : "You"}</span>
              {e.seconds !== undefined && e.seconds !== null && (
                <span className={`dur ${e.seconds > ANSWER_TARGET_S ? "over" : ""}`}>{Math.round(e.seconds)}s</span>
              )}
              <p>{e.text}</p>
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      )}

      {phase === "debriefing" && <p className="hint">Grading the session against the pack's verified facts…</p>}

      {phase === "done" && scorecard && (
        <div className="scorecard">
          <h2>Debrief</h2>
          <MarkdownRenderer content={scorecard} />
          {savedPath && <p className="hint">saved: {savedPath}</p>}
          <button className="btn primary" onClick={() => setPhase("idle")}>Run another session</button>
        </div>
      )}
    </div>
  );
}
