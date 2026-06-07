import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioPlayback,
  AudioWorkletCapture,
  DraggableWindow,
  MarkdownRenderer,
  RealtimeClient,
  VideoCapture,
} from "@assistants/core-web";
import type { VideoDeviceInfo, VideoSourceKind } from "@assistants/core-web";
import { CaptureCanvas, type CaptureCanvasHandle, type CaptureTool } from "./components/CaptureCanvas";
import { ControlBar } from "./components/ControlBar";
import { api } from "./lib/api";
import { compositeFrame, cropFrame, type Rect } from "./lib/capture";
import { PROMPT_TEMPLATES, type PromptTemplate } from "./lib/templates";

interface ChatItem {
  role: "user" | "assistant";
  text: string;
  image?: string;
}

export function App() {
  // ── imperative singletons ───────────────────────────────────────────────────
  const vcRef = useRef<VideoCapture | null>(null);
  if (vcRef.current === null) vcRef.current = new VideoCapture();
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const captureRef = useRef<CaptureCanvasHandle | null>(null);
  const rtRef = useRef<RealtimeClient | null>(null);
  const audioRef = useRef<AudioWorkletCapture | null>(null);
  const frameTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveBuf = useRef("");
  const playbackRef = useRef<AudioPlayback | null>(null);
  const audioOutRef = useRef(true);

  // ── state ────────────────────────────────────────────────────────────────────
  const [source, setSource] = useState<VideoSourceKind>("none");
  const [devices, setDevices] = useState<VideoDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [videoDims, setVideoDims] = useState({ w: 0, h: 0 });
  const [boxDims, setBoxDims] = useState({ w: window.innerWidth, h: window.innerHeight });

  const [tool, setTool] = useState<CaptureTool>("none");
  const [liveOn, setLiveOn] = useState(false);
  const [liveStatus, setLiveStatus] = useState("disconnected");
  const [liveTurns, setLiveTurns] = useState<string[]>([]);
  const [liveCurrent, setLiveCurrent] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [audioOut, setAudioOut] = useState(true);
  audioOutRef.current = audioOut;

  const [analysis, setAnalysis] = useState<ChatItem[]>([]);
  const [analyzeText, setAnalyzeText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const [showLive, setShowLive] = useState(false);
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [pinnedContext, setPinnedContext] = useState("");
  const [analyzeRole, setAnalyzeRole] = useState("reason_deep");
  const [frameRate, setFrameRate] = useState(2);
  const [quality, setQuality] = useState(0.7);

  // ── effects ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem("coding.pinnedContext");
    if (stored) setPinnedContext(stored);
  }, []);

  useEffect(() => {
    const onResize = () => setBoxDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── live mode ──────────────────────────────────────────────────────────────--
  const startAudio = useCallback(async (rt: RealtimeClient) => {
    const cap = new AudioWorkletCapture();
    audioRef.current = cap;
    await cap.start({ onAudio: (b64) => rt.sendAudio(b64), onLevel: setLevel });
  }, []);

  const stopLive = useCallback(() => {
    if (frameTimer.current) {
      clearInterval(frameTimer.current);
      frameTimer.current = null;
    }
    audioRef.current?.stop();
    audioRef.current = null;
    rtRef.current?.close();
    rtRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    setLevel(0);
    setLiveOn(false);
    setLiveStatus("disconnected");
  }, []);

  const startLive = useCallback(() => {
    if (liveOn) return;
    liveBuf.current = "";
    setLiveCurrent("");
    playbackRef.current = new AudioPlayback();
    const rt = new RealtimeClient(
      `ws://${window.location.host}/ws/live`,
      {
        onOpen: () => {
          setLiveStatus("connecting");
          rt.sendConfig();
        },
        onStatus: setLiveStatus,
        onText: (delta) => {
          liveBuf.current += delta;
          setLiveCurrent(liveBuf.current);
        },
        onAudio: (b64) => {
          if (audioOutRef.current) playbackRef.current?.enqueue(b64);
        },
        onTurnComplete: () => {
          const turn = liveBuf.current;
          if (turn) setLiveTurns((t) => [...t, turn]);
          liveBuf.current = "";
          setLiveCurrent("");
        },
        onError: (e) => setLiveStatus(`error: ${e}`),
        onClose: () => setLiveStatus("disconnected"),
      },
      { reconnect: false },
    );
    rt.connect();
    rtRef.current = rt;
    setShowLive(true);
    setLiveOn(true);

    frameTimer.current = setInterval(() => {
      const el = videoElRef.current;
      if (!el) return;
      const b64 = compositeFrame(el, captureRef.current?.getCanvas() ?? null, {
        maxWidth: 1280,
        maxHeight: 720,
        quality,
      });
      if (b64) rt.sendImage(b64);
    }, Math.round(1000 / frameRate));

    if (micOn) void startAudio(rt);
  }, [liveOn, micOn, frameRate, quality, startAudio]);

  const toggleMic = useCallback(async () => {
    if (micOn) {
      audioRef.current?.stop();
      audioRef.current = null;
      setLevel(0);
      setMicOn(false);
      return;
    }
    setMicOn(true);
    if (liveOn && rtRef.current) await startAudio(rtRef.current);
  }, [micOn, liveOn, startAudio]);

  // ── feed ───────────────────────────────────────────────────────────────────--
  const startSource = useCallback(
    async (kind: "camera" | "screen" | "device") => {
      const vc = vcRef.current;
      if (!vc) return;
      try {
        const stream =
          kind === "camera"
            ? await vc.startCamera()
            : kind === "screen"
              ? await vc.startScreen()
              : await vc.startDevice(selectedDevice);
        const el = videoElRef.current;
        if (el) {
          el.srcObject = stream;
          await el.play().catch(() => undefined);
        }
        setSource(vc.kind);
        setDevices(await VideoCapture.listVideoInputs());
      } catch (e) {
        alert(`Could not start ${kind}: ${(e as Error).message}`);
      }
    },
    [selectedDevice],
  );

  const stopSource = useCallback(() => {
    stopLive();
    vcRef.current?.stop();
    const el = videoElRef.current;
    if (el) el.srcObject = null;
    setSource("none");
    setVideoDims({ w: 0, h: 0 });
  }, [stopLive]);

  useEffect(() => () => stopLive(), [stopLive]);

  // ── analyze / OCR / templates / region ───────────────────────────────────────
  const runAnalyze = useCallback(
    async (promptText: string, imageOverride?: string | null) => {
      const el = videoElRef.current;
      const image =
        imageOverride !== undefined
          ? imageOverride
          : el
            ? compositeFrame(el, captureRef.current?.getCanvas() ?? null, { quality: 0.92 })
            : null;
      setShowAnalyze(true);
      setAnalysis((a) => [...a, { role: "user", text: promptText, image: image ?? undefined }]);
      setAnalyzing(true);
      try {
        const res = await api.analyze({
          text: promptText,
          image,
          context: pinnedContext || undefined,
          role: analyzeRole,
        });
        setAnalysis((a) => [...a, { role: "assistant", text: res.response }]);
      } catch (e) {
        setAnalysis((a) => [...a, { role: "assistant", text: `⚠️ ${(e as Error).message}` }]);
      } finally {
        setAnalyzing(false);
      }
    },
    [pinnedContext, analyzeRole],
  );

  const runOcr = useCallback(async () => {
    const el = videoElRef.current;
    if (!el) return;
    const image = compositeFrame(el, captureRef.current?.getCanvas() ?? null, { quality: 0.92 });
    if (!image) return;
    setShowAnalyze(true);
    setAnalysis((a) => [...a, { role: "user", text: "OCR — extract text from screen", image }]);
    setAnalyzing(true);
    try {
      const res = await api.ocr(image);
      setAnalysis((a) => [...a, { role: "assistant", text: res.text }]);
    } catch (e) {
      setAnalysis((a) => [...a, { role: "assistant", text: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const onTemplate = useCallback(
    (t: PromptTemplate) => {
      if (liveOn) rtRef.current?.sendText(t.prompt);
      else void runAnalyze(t.prompt);
    },
    [liveOn, runAnalyze],
  );

  const onRegion = useCallback(
    (rect: Rect) => {
      const el = videoElRef.current;
      const size = captureRef.current?.getContentSize();
      if (!el || !size) return;
      const image = cropFrame(el, captureRef.current?.getCanvas() ?? null, rect, size.w, size.h, 0.92);
      setTool("none");
      void runAnalyze("Analyze this selected region of the screen.", image);
    },
    [runAnalyze],
  );

  const submitAnalyze = useCallback(() => {
    const text = analyzeText.trim();
    if (!text) return;
    setAnalyzeText("");
    void runAnalyze(text);
  }, [analyzeText, runAnalyze]);

  const updatePinned = useCallback((v: string) => {
    setPinnedContext(v);
    localStorage.setItem("coding.pinnedContext", v);
  }, []);

  // ── render ─────────────────────────────────────────────────────────────────--
  const hasFeed = source !== "none";
  return (
    <>
      <div className="feed-stage">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoElRef}
          className="feed-video"
          muted
          playsInline
          autoPlay
          onLoadedMetadata={() => {
            const el = videoElRef.current;
            if (el) setVideoDims({ w: el.videoWidth, h: el.videoHeight });
          }}
        />
        {!hasFeed && (
          <div className="feed-empty">
            Coding Copilot — start a <b>Camera</b> or <b>Screen</b> feed below, then go ⚡ Live or 🔬
            analyze.
          </div>
        )}
      </div>

      {hasFeed && videoDims.w > 0 && (
        <CaptureCanvas
          ref={captureRef}
          videoW={videoDims.w}
          videoH={videoDims.h}
          boxW={boxDims.w}
          boxH={boxDims.h}
          tool={tool}
          onRegion={onRegion}
        />
      )}

      {showLive && (
        <DraggableWindow title={`⚡ Live · ${liveStatus}`} initialX={24} initialY={24} width={380} onClose={() => setShowLive(false)}>
          <div className="panel-chat">
            {liveTurns.length === 0 && !liveCurrent && <div className="hint">Live commentary will stream here…</div>}
            {liveTurns.map((turn, i) => (
              <div key={i} className="msg">
                <MarkdownRenderer content={turn} />
              </div>
            ))}
            {liveCurrent && (
              <div className="msg">
                <MarkdownRenderer content={liveCurrent} />
              </div>
            )}
          </div>
        </DraggableWindow>
      )}

      {showAnalyze && (
        <DraggableWindow title="🔬 Analysis" initialX={window.innerWidth - 440} initialY={24} width={400} height={360} onClose={() => setShowAnalyze(false)}>
          <div className="panel-chat">
            {analysis.length === 0 && <div className="hint">Ask a question, pick a template, OCR, or select a region.</div>}
            {analysis.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="who">{m.role}</div>
                {m.role === "assistant" ? <MarkdownRenderer content={m.text} /> : <div>{m.text}</div>}
                {m.image && <img className="thumb" src={`data:image/jpeg;base64,${m.image}`} alt="frame" />}
              </div>
            ))}
            {analyzing && <div className="hint">analyzing…</div>}
          </div>
          <div className="analyze-input">
            <textarea
              value={analyzeText}
              placeholder="Ask about the code on screen… (Ctrl+Enter)"
              onChange={(e) => setAnalyzeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submitAnalyze();
                }
              }}
            />
            <button className="btn" disabled={analyzing} onClick={submitAnalyze}>Send</button>
          </div>
        </DraggableWindow>
      )}

      {showSettings && (
        <DraggableWindow title="⚙ Settings" initialX={window.innerWidth / 2 - 200} initialY={80} width={400} height={300} onClose={() => setShowSettings(false)}>
          <div className="panel-chat">
            <label>
              Pinned project context
              <textarea
                style={{ width: "100%", minHeight: 90, marginTop: 4 }}
                value={pinnedContext}
                onChange={(e) => updatePinned(e.target.value)}
                placeholder="e.g. This is a FastAPI + React monorepo…"
              />
            </label>
            <label>
              Analyze model{" "}
              <select className="btn" value={analyzeRole} onChange={(e) => setAnalyzeRole(e.target.value)}>
                <option value="reason_deep">Deep (Opus 4.8)</option>
                <option value="reason_balanced">Balanced (Sonnet 4.6)</option>
                <option value="reason_fast">Fast (Haiku 4.5)</option>
              </select>
            </label>
            <label>
              Live frame rate: {frameRate} fps
              <input type="range" min={1} max={5} value={frameRate} onChange={(e) => setFrameRate(Number(e.target.value))} style={{ width: "100%" }} />
            </label>
            <label>
              Live frame quality: {quality.toFixed(2)}
              <input type="range" min={0.3} max={0.9} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} style={{ width: "100%" }} />
            </label>
            <div className="hint">Frame-rate / quality changes apply next time you toggle Live.</div>
          </div>
        </DraggableWindow>
      )}

      <ControlBar
        source={source}
        devices={devices}
        selectedDevice={selectedDevice}
        onSelectDevice={setSelectedDevice}
        onStart={startSource}
        onStop={stopSource}
        liveOn={liveOn}
        liveStatus={liveStatus}
        onToggleLive={() => (liveOn ? stopLive() : startLive())}
        micOn={micOn}
        level={level}
        onToggleMic={() => void toggleMic()}
        audioOut={audioOut}
        onToggleAudioOut={() => setAudioOut((v) => !v)}
        tool={tool}
        onTool={setTool}
        onClearAnnotations={() => captureRef.current?.clear()}
        onOcr={() => void runOcr()}
        templates={PROMPT_TEMPLATES}
        onTemplate={onTemplate}
        onToggleSettings={() => setShowSettings((s) => !s)}
        busy={analyzing}
      />
    </>
  );
}
