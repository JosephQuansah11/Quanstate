import { matchVoice, pcm16ToFloat, type PcmAudioSink, type SpeakOptions, type SpeechSink } from "@quanstate/services";

/** Browser speech synthesis with the best matching installed voice. */
export class BrowserSpeechSink implements SpeechSink {
  private voices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (this.available) {
      this.refresh();
      window.speechSynthesis.addEventListener?.("voiceschanged", () => this.refresh());
    }
  }

  get available(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  speak(text: string, language: string, options: SpeakOptions = {}): Promise<void> {
    if (!this.available) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = matchVoice(language, this.voices);
      if (voice) {
        const resolved = this.voices.find((candidate) => candidate.name === voice.name);
        if (resolved) utterance.voice = resolved;
        utterance.lang = resolved?.lang ?? voice.lang;
      } else {
        utterance.lang = language;
      }
      utterance.rate = options.rate ?? 1.02;
      utterance.pitch = options.pitch ?? 1;
      utterance.volume = options.volume ?? 1;
      utterance.onend = () => resolve();
      utterance.onerror = (event) => {
        if (event.error === "interrupted" || event.error === "canceled") resolve();
        else reject(new Error(`Speech synthesis failed: ${event.error}`));
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  cancel(): void {
    if (this.available) window.speechSynthesis.cancel();
  }

  private refresh(): void {
    this.voices = window.speechSynthesis.getVoices();
  }
}

/**
 * Plays streamed PCM16 from the service (server-side TTS).
 * A tiny jitter buffer keeps playback smooth without adding perceived latency.
 */
export class WebPcmPlayer implements PcmAudioSink {
  private context: AudioContext | null = null;
  private nextStart = 0;
  private scheduled = 0;

  enqueue(chunk: Uint8Array, sampleRate: number): void {
    const context = this.ensureContext();
    const samples = pcm16ToFloat(chunk);
    if (samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.04, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
    this.scheduled += 1;
  }

  stop(): void {
    this.nextStart = 0;
    this.scheduled = 0;
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }

  private ensureContext(): AudioContext {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext({ latencyHint: "interactive" });
    }
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    return this.context;
  }
}
