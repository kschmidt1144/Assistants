import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioPlayback,
  AudioWorkletCapture,
  HudWindow,
  MarkdownRenderer,
  RealtimeClient,
  resetHudLayout,
  VideoCapture,
} from "@assistants/core-web";
import type { HudTone, VideoDeviceInfo, VideoSourceKind } from "@assistants/core-web";
import { CaptureCanvas, type CaptureCanvasHandle, type CaptureTool } from "./components/CaptureCanvas";
import { ControlBar } from "./components/ControlBar";
import { QuickActions } from "./components/QuickActions";
import { ANALYZE_SCREEN_PROMPT, buildQuickActions, shortcutMap } from "./lib/actions";
import { api } from "./lib/api";
import { compositeFrame, cropFrame, type Rect } from "./lib/capture";
import { deckHome, dockSlots, feedRect, hasRightRail } from "./lib/layout";
import { PROMPT_TEMPLATES, type PromptTemplate } from "./lib/templates";

interface ChatItem {
  role: "user" | "assistant";
  text: string;
  image?: string;
}

// ── title-bar glyphs (lucide-ish strokes) ───────────────────────────────────
function Stroke({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const I_ZAP = <Stroke d="M13 2L4.5 13.5H11l-1 8.5L18.5 10.5H12z" />;
const I_SCOPE = <Stroke d="M9 3h6M10 3v5.2a6 6 0 1 0 4 0V3M7.5 15h9" />;
const I_GEAR = <Stroke d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.4H9.4l-.3 2.4a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.4h4.9l.3-2.4a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" />;

function liveTone(status: string, liveOn: boolean): HudTone {
  if (status.startsWith("error")) return "bad";
  if (status === "connecting") return "warn";
  if (liveOn || status === "connected" || status === "streaming") return "live";
  return "neutral";
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
  const [showActions, setShowActions] = useState(false);
  const [tileNonce, setTileNonce] = useState(0);

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

  // ── anchored layout ────────────────────────────────────────────────────────--
  // The feed is pinned top-left at native 1:1 (never upscaled); the right rail
  // holds the chat panels (Live over Analysis) and the strip beneath holds the
  // control deck.
  const feed = useMemo(
    () => feedRect(videoDims.w, videoDims.h, boxDims.w, boxDims.h),
    [videoDims.w, videoDims.h, boxDims.w, boxDims.h],
  );
  const slots = useMemo(() => dockSlots(feed, boxDims.w, boxDims.h), [feed, boxDims.w, boxDims.h]);
  const deck = useMemo(() => deckHome(feed, boxDims.w, boxDims.h), [feed, boxDims.w, boxDims.h]);

  /** Snap the floating panels + deck back to their default homes around the feed. */
  const resetLayout = useCallback(() => {
    resetHudLayout("coding"); // clear persisted geometry so closed panels reopen docked
    setTileNonce((n) => n + 1); // …and move any open panels + the deck there now
  }, []);

  // One-time: the first time a feed shows a usable rail, auto-arrange so existing
  // users immediately get the new layout (drag freely afterwards — runs once).
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || source === "none" || videoDims.w === 0) return;
    if (!hasRightRail(feed, boxDims.w)) return;
    migrated.current = true;
    if (localStorage.getItem("coding.layout.v2")) return;
    localStorage.setItem("coding.layout.v2", "1");
    resetLayout();
  }, [source, videoDims.w, feed, boxDims.w, resetLayout]);

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

  // ── quick actions (control bar + ⌘K palette + hotkeys) ───────────────────────
  // Prompt-style actions route like a chat turn when Live is on, else a one-shot
  // deep analysis of the current frame.
  const runPrompt = useCallback(
    (prompt: string) => {
      if (liveOn) rtRef.current?.sendText(prompt);
      else void runAnalyze(prompt);
    },
    [liveOn, runAnalyze],
  );
  const analyzeScreen = useCallback(() => runPrompt(ANALYZE_SCREEN_PROMPT), [runPrompt]);
  const analyzeRegion = useCallback(() => setTool("region"), []);
  const runTemplate = useCallback((t: PromptTemplate) => runPrompt(t.prompt), [runPrompt]);

  const hasFeed = source !== "none";
  const quickActions = useMemo(
    () =>
      buildQuickActions({
        hasFeed,
        analyzeScreen,
        analyzeRegion,
        ocr: () => void runOcr(),
        runTemplate,
        templates: PROMPT_TEMPLATES,
      }),
    [hasFeed, analyzeScreen, analyzeRegion, runOcr, runTemplate],
  );

  // ⌘K toggles the palette; single-key shortcuts (A/R/O) fire capture actions
  // when the user isn't typing into a field and the palette is closed.
  useEffect(() => {
    const keys = shortcutMap(quickActions);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowActions((s) => !s);
        return;
      }
      if (showActions || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) {
        return;
      }
      const a = keys.get(e.key.toLowerCase());
      if (a && !a.disabled) {
        e.preventDefault();
        a.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickActions, showActions]);

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
  return (
    <>
      <div className="feed-stage">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoElRef}
          className={`feed-video${hasFeed ? " on" : ""}`}
          style={hasFeed && videoDims.w > 0 ? { width: Math.round(feed.w), height: Math.round(feed.h) } : undefined}
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
            <div className="feed-empty-badge">⌖</div>
            <h1>Coding Copilot</h1>
            <p>
              Start a <b>Camera</b> or <b>Screen</b> feed from the deck below, then go ⚡ Live for
              streaming commentary or 🔬 analyze a frame. Panels float over the feed — drag, resize,
              and dim them to read the screen behind.
            </p>
          </div>
        )}
      </div>

      {hasFeed && (
        <div className={`feed-status pill ${liveOn ? "live" : "neutral"}`}>
          {source === "screen" ? "Screen" : source === "camera" ? "Camera" : "Device"}
          {videoDims.w > 0 ? ` · ${videoDims.w}×${videoDims.h}` : ""}
          {liveOn ? " · live" : ""}
        </div>
      )}

      {hasFeed && videoDims.w > 0 && (
        <CaptureCanvas
          ref={captureRef}
          videoW={videoDims.w}
          videoH={videoDims.h}
          boxW={boxDims.w}
          boxH={boxDims.h}
          rect={feed}
          tool={tool}
          onRegion={onRegion}
        />
      )}

      {showLive && (
        <HudWindow
          id="coding.live"
          title="Live"
          icon={I_ZAP}
          statusPill={{ label: liveStatus, tone: liveTone(liveStatus, liveOn) }}
          defaultPos={{ x: slots.live.x, y: slots.live.y }}
          defaultSize={{ w: slots.live.w, h: slots.live.h }}
          place={slots.live}
          placeNonce={tileNonce}
          defaultOpacity={0.85}
          onClose={() => setShowLive(false)}
        >
          <div className="panel-chat">
            {liveTurns.length === 0 && !liveCurrent && <div className="hint">Live commentary will stream here…</div>}
            {liveTurns.map((turn, i) => (
              <div key={i} className="msg">
                <MarkdownRenderer content={turn} />
              </div>
            ))}
            {liveCurrent && (
              <div className="msg streaming">
                <MarkdownRenderer content={liveCurrent} />
              </div>
            )}
          </div>
        </HudWindow>
      )}

      {showAnalyze && (
        <HudWindow
          id="coding.analyze"
          title="Analysis"
          icon={I_SCOPE}
          defaultPos={{ x: slots.analyze.x, y: slots.analyze.y }}
          defaultSize={{ w: slots.analyze.w, h: slots.analyze.h }}
          place={slots.analyze}
          placeNonce={tileNonce}
          defaultOpacity={0.85}
          onClose={() => setShowAnalyze(false)}
        >
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
            <button className="btn primary" disabled={analyzing} onClick={submitAnalyze}>Send</button>
          </div>
        </HudWindow>
      )}

      {showSettings && (
        <HudWindow
          id="coding.settings"
          title="Settings"
          icon={I_GEAR}
          defaultPos={{ x: Math.round(window.innerWidth / 2 - 200), y: 80 }}
          defaultSize={{ w: 400, h: 320 }}
          defaultOpacity={1}
          onClose={() => setShowSettings(false)}
        >
          <div className="settings-form">
            <label className="field">
              <span className="field-label">Pinned project context</span>
              <textarea
                style={{ minHeight: 90, marginTop: 4 }}
                value={pinnedContext}
                onChange={(e) => updatePinned(e.target.value)}
                placeholder="e.g. This is a FastAPI + React monorepo…"
              />
            </label>
            <label className="field">
              <span className="field-label">Analyze model</span>
              <select className="btn" value={analyzeRole} onChange={(e) => setAnalyzeRole(e.target.value)}>
                <option value="reason_deep">Deep (Opus 4.8)</option>
                <option value="reason_balanced">Balanced (Sonnet 4.6)</option>
                <option value="reason_fast">Fast (Haiku 4.5)</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Live frame rate <span className="mono">{frameRate} fps</span></span>
              <input type="range" className="hud-range" min={1} max={5} value={frameRate} onChange={(e) => setFrameRate(Number(e.target.value))} />
            </label>
            <label className="field">
              <span className="field-label">Live frame quality <span className="mono">{quality.toFixed(2)}</span></span>
              <input type="range" className="hud-range" min={0.3} max={0.9} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
            </label>
            <div className="hint">Frame-rate / quality changes apply next time you toggle Live.</div>
            <div className="settings-actions">
              <button className="btn" onClick={resetLayout}>Reset panel layout</button>
            </div>
          </div>
        </HudWindow>
      )}

      <QuickActions open={showActions} actions={quickActions} onClose={() => setShowActions(false)} />

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
        onAnalyze={analyzeScreen}
        onOcr={() => void runOcr()}
        onOpenActions={() => setShowActions(true)}
        onToggleSettings={() => setShowSettings((s) => !s)}
        busy={analyzing}
        homePos={deck}
        placeNonce={tileNonce}
      />
    </>
  );
}
