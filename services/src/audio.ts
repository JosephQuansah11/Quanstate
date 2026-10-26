/**
 * Client-side audio plumbing: microphone capture -> 20 ms PCM16 frames, and
 * native text-to-speech output.  Platform modules (Web Audio, Expo AV) implement
 * `AudioCapture` / `SpeechSink`; this file owns the reusable, testable parts.
 */

import { PcmFrameChunker, TARGET_SAMPLE_RATE, rms } from "./pcm";

export interface AudioCapture {
  readonly sampleRate: number;
  start(onSamples: (samples: Float32Array, sampleRate: number) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface MicrophoneStreamOptions {
  /** Receives exactly-sized 20 ms PCM16 mono frames at 16 kHz. */
  onFrame: (frame: Uint8Array) => void;
  onLevel?: (level: number) => void;
  frameSamples?: number;
}

/** Wraps a platform capture adapter and normalises its output for the socket. */
export class MicrophoneStream {
  private chunker: PcmFrameChunker;
  private running = false;

  constructor(
    private readonly capture: AudioCapture,
    private readonly options: MicrophoneStreamOptions,
  ) {
    this.chunker = new PcmFrameChunker(
      options.frameSamples,
      capture.sampleRate || TARGET_SAMPLE_RATE,
    );
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.chunker = new PcmFrameChunker(this.options.frameSamples, this.capture.sampleRate || TARGET_SAMPLE_RATE);
    await this.capture.start((samples) => {
      this.options.onLevel?.(rms(samples));
      for (const frame of this.chunker.push(samples)) {
        this.options.onFrame(frame);
      }
    });
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    await this.capture.stop();
    const tail = this.chunker.flush();
    if (tail) this.options.onFrame(tail);
    this.running = false;
  }
}

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface SpeechSink {
  readonly available: boolean;
  speak(text: string, language: string, options?: SpeakOptions): Promise<void>;
  cancel(): void;
}

export interface SpeechQueueOptions {
  sink: SpeechSink;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

export interface QueuedUtterance {
  text: string;
  language: string;
}

/**
 * Serialises translations into the platform voice and drops duplicates.
 * Speaking on the client is what keeps perceived latency near zero: the voice
 * starts the moment the translated text event arrives.
 */
export class SpeechQueue {
  private queue: QueuedUtterance[] = [];
  private speaking = false;
  private enabled: boolean;

  constructor(private readonly options: SpeechQueueOptions) {
    this.enabled = options.enabled ?? true;
  }

  enqueue(text: string, language: string): void {
    const clean = text.trim();
    if (!clean || !this.enabled || !this.options.sink.available) return;
    if (this.queue.some((item) => item.text === clean && item.language === language)) return;
    this.queue.push({ text: clean, language });
    void this.drain();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  cancel(): void {
    this.queue = [];
    this.options.sink.cancel();
    this.speaking = false;
  }

  private async drain(): Promise<void> {
    if (this.speaking) return;
    this.speaking = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) break;
        await this.options.sink.speak(next.text, next.language);
      }
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.speaking = false;
    }
  }
}

export interface PcmAudioSink {
  enqueue(chunk: Uint8Array, sampleRate: number): void;
  stop(): void;
}

/** Feeds streamed server TTS (PCM16) into a platform audio player. */
export class ServerVoicePlayer {
  private sources = new Map<string, { sampleRate: number }>();

  constructor(
    private readonly sink: PcmAudioSink,
    private readonly fallbackSampleRate = 16_000,
  ) {}

  begin(id: string, sampleRate: number): void {
    this.sources.set(id, { sampleRate: sampleRate || this.fallbackSampleRate });
  }

  push(id: string, chunk: ArrayBuffer): void {
    const meta = this.sources.get(id);
    this.sink.enqueue(new Uint8Array(chunk), meta?.sampleRate ?? this.fallbackSampleRate);
  }

  end(id: string): void {
    this.sources.delete(id);
  }

  stop(): void {
    this.sources.clear();
    this.sink.stop();
  }
}
