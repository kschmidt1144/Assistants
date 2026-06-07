/** Live transcription via the browser Web Speech API (free, no key) — used by the Meeting app. */

export interface TranscriptResult {
  text: string;
  isFinal: boolean;
}

export interface SpeechTranscriptionOptions {
  lang?: string;
  onResult: (result: TranscriptResult) => void;
  onError?: (error: string) => void;
}

// Minimal shape of the (non-standard, prefixed) Web Speech API.
interface RecAlternative {
  transcript: string;
}
interface RecResult {
  0: RecAlternative;
  isFinal: boolean;
}
interface RecResultList {
  length: number;
  [index: number]: RecResult;
}
interface RecEvent {
  resultIndex: number;
  results: RecResultList;
}
interface RecErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: RecEvent) => void) | null;
  onerror: ((ev: RecErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class SpeechTranscription {
  private rec: SpeechRecognitionLike | null = null;
  private running = false;

  static isSupported(): boolean {
    return getCtor() !== null;
  }

  start(opts: SpeechTranscriptionOptions): void {
    const Ctor = getCtor();
    if (!Ctor) {
      opts.onError?.("Web Speech API not supported (try Chrome).");
      return;
    }
    const rec = new Ctor();
    rec.lang = opts.lang ?? "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (!res) continue;
        const text = res[0].transcript;
        if (res.isFinal) opts.onResult({ text, isFinal: true });
        else interim += text;
      }
      if (interim) opts.onResult({ text: interim, isFinal: false });
    };
    rec.onerror = (ev) => opts.onError?.(ev.error);
    rec.onend = () => {
      // Web Speech stops on silence; restart while we're meant to be running.
      if (this.running) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    this.rec = rec;
    this.running = true;
    rec.start();
  }

  stop(): void {
    this.running = false;
    this.rec?.stop();
    this.rec = null;
  }
}
