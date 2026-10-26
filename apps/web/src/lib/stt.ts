/**
 * Optional on-device speech recognition (Chrome/Edge/Safari Web Speech API).
 *
 * On-device recognition supplies instant partials while the microphone audio is
 * still streamed to the service, where the VAD, translation memory and server
 * STT (when configured) run.  If the browser lacks support, the device falls
 * back to server STT or typed input.
 */

interface SpeechAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative;
}

interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: SpeechResultList;
}

interface SpeechErrorEvent {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface OnDeviceOptions {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
}

function recognitionCtor(): SpeechRecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export class OnDeviceSpeech {
  private recognition: SpeechRecognitionLike | null = null;
  private running = false;
  private language = "en-US";

  get available(): boolean {
    return typeof window !== "undefined" && recognitionCtor() !== null;
  }

  get listening(): boolean {
    return this.running;
  }

  start(language: string, options: OnDeviceOptions): boolean {
    const Ctor = recognitionCtor();
    if (!Ctor) return false;
    this.stop();
    this.language = language;
    this.running = true;

    const attach = () => {
      const recognition = new Ctor();
      recognition.lang = this.language;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result) continue;
          const alternative = result[0];
          if (!alternative) continue;
          const text = alternative.transcript.trim();
          if (!text) continue;
          if (result.isFinal) options.onFinal(text);
          else interim += ` ${text}`;
        }
        if (interim.trim()) options.onPartial?.(interim.trim());
      };
      recognition.onerror = (event) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        options.onError?.(`On-device speech: ${event.error}`);
      };
      recognition.onend = () => {
        if (this.running) {
          try {
            recognition.start();
          } catch {
            /* Chrome throws if restarted too quickly; it will recover on retry */
          }
        }
      };
      this.recognition = recognition;
      recognition.start();
    };

    attach();
    return true;
  }

  stop(): void {
    this.running = false;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    }
  }
}
