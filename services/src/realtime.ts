/**
 * A live translation session shared by web, iOS and Android.
 *
 * The session owns the protocol lifecycle (start -> audio/text -> events ->
 * stop), tracks latency, and re-establishes itself after a network drop.
 */

import { BudgetTracker, LatencyStats } from "./metrics";
import {
  ProtocolError,
  parseServerMessage,
  sessionStartMessage,
  type ServerMessage,
  type SessionReady,
  type TranslationEvent,
  type TtsStart,
} from "./protocol";
import type { RealtimeTransport, TransportStatus } from "./transport";

export interface RealtimeSessionOptions {
  transport: RealtimeTransport;
  sourceLang: string;
  targetLang: string;
  profile?: string;
  ttsMode?: "client" | "server";
  sampleRate?: number;
  hotwords?: string[];
  onEvent?: (event: ServerMessage) => void;
  onTranslation?: (event: TranslationEvent) => void;
  onPartial?: (text: string, id: string) => void;
  onFinal?: (text: string, id: string) => void;
  onAudioChunk?: (chunk: ArrayBuffer, meta: TtsStart) => void;
  onStatus?: (status: TransportStatus) => void;
  onError?: (message: string, code: string) => void;
}

export type SessionState = "idle" | "connecting" | "live" | "reconnecting" | "stopped";

export class RealtimeSession {
  readonly transport: RealtimeTransport;
  readonly budget = new BudgetTracker(100, 5);
  readonly latency = new LatencyStats();
  readonly stats = { partials: 0, finals: 0, translations: 0, audioChunks: 0 };

  sourceLang: string;
  targetLang: string;
  ttsMode: "client" | "server";
  profile: string;
  state: SessionState = "idle";
  ready: SessionReady | null = null;
  lastError: { code: string; message: string } | null = null;

  private readonly options: RealtimeSessionOptions;
  private readonly unsubscribers: Array<() => void> = [];
  private activeTts: TtsStart | null = null;
  private readyWaiters: Array<{ resolve: (ready: SessionReady) => void; reject: (error: Error) => void }> = [];
  private everReady = false;

  constructor(options: RealtimeSessionOptions) {
    this.options = options;
    this.transport = options.transport;
    this.sourceLang = options.sourceLang;
    this.targetLang = options.targetLang;
    this.ttsMode = options.ttsMode ?? "client";
    this.profile = options.profile ?? "default";

    this.unsubscribers.push(
      this.transport.onMessage((raw) => this.handleMessage(raw)),
      this.transport.onBinary((data) => this.handleBinary(data)),
      this.transport.onStatus((status) => this.handleStatus(status)),
    );
  }

  async start(timeoutMs = 8_000): Promise<SessionReady> {
    this.state = "connecting";
    await this.transport.connect();
    const ready = this.waitForReady(timeoutMs);
    this.transport.send(
      sessionStartMessage({
        sourceLang: this.sourceLang,
        targetLang: this.targetLang,
        profile: this.profile,
        ttsMode: this.ttsMode,
        sampleRate: this.options.sampleRate ?? 16_000,
        hotwords: this.options.hotwords,
      }),
    );
    return ready;
  }

  /** Send one 20 ms PCM16 frame from the microphone. */
  pushAudio(frame: Uint8Array): boolean {
    return this.transport.sendAudio(frame);
  }

  sendText(text: string, id?: string): void {
    if (!text.trim()) return;
    this.transport.send({ type: "text.input", text: text.trim(), id });
  }

  flushAudio(): void {
    this.transport.send({ type: "audio.flush" });
  }

  setLanguages(sourceLang: string, targetLang: string): void {
    this.sourceLang = sourceLang;
    this.targetLang = targetLang;
    this.transport.send({ type: "config.update", sourceLang, targetLang });
  }

  setTtsMode(ttsMode: "client" | "server"): void {
    this.ttsMode = ttsMode;
    this.transport.send({ type: "config.update", ttsMode });
  }

  setHotwords(hotwords: string[]): void {
    this.transport.send({ type: "config.update", hotwords });
  }

  requestStats(): void {
    this.transport.ping();
  }

  stop(): void {
    this.state = "stopped";
    this.transport.send({ type: "session.stop" });
    this.transport.close();
    this.cleanup();
  }

  get rttMs(): number {
    return this.transport.rttMs;
  }

  dispose(): void {
    this.cleanup();
    this.transport.close();
  }

  private cleanup(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  private waitForReady(timeoutMs: number): Promise<SessionReady> {
    if (this.ready && this.state === "live") return Promise.resolve(this.ready);
    return new Promise<SessionReady>((resolve, reject) => {
      const wrappedResolve = (ready: SessionReady) => {
        clearTimeout(timer);
        resolve(ready);
      };
      const wrappedReject = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((waiter) => waiter.resolve !== wrappedResolve);
        reject(new Error(`Timed out waiting for session.ready after ${timeoutMs} ms`));
      }, timeoutMs);
      this.readyWaiters.push({ resolve: wrappedResolve, reject: wrappedReject });
    });
  }


  private resolveReady(ready: SessionReady): void {
    this.ready = ready;
    this.everReady = true;
    this.state = "live";
    this.sourceLang = ready.sourceLang;
    this.targetLang = ready.targetLang;
    this.ttsMode = ready.ttsMode;
    for (const waiter of this.readyWaiters.splice(0)) waiter.resolve(ready);
  }

  private failReady(error: Error): void {
    for (const waiter of this.readyWaiters.splice(0)) waiter.reject(error);
  }

  private handleStatus(status: TransportStatus): void {
    this.options.onStatus?.(status);
    if (status === "reconnecting") {
      this.state = "reconnecting";
      return;
    }
    if (status === "open" && this.everReady && this.state === "reconnecting") {
      // Re-establish the session on the fresh socket.
      this.transport.send(
        sessionStartMessage({
          sourceLang: this.sourceLang,
          targetLang: this.targetLang,
          profile: this.profile,
          ttsMode: this.ttsMode,
          sampleRate: this.options.sampleRate ?? 16_000,
        }),
      );
    }
  }

  private handleMessage(raw: string): void {
    let message: ServerMessage;
    try {
      message = parseServerMessage(raw);
    } catch (error) {
      const detail = error instanceof ProtocolError ? error.message : "Unparseable server message";
      this.lastError = { code: "protocol", message: detail };
      this.options.onError?.(detail, "protocol");
      return;
    }

    this.options.onEvent?.(message);

    switch (message.type) {
      case "session.ready":
        this.resolveReady(message);
        break;
      case "stt.partial":
        this.stats.partials += 1;
        this.latency.record("stt_partial", message.latencyMs);
        this.options.onPartial?.(message.text, message.id);
        break;
      case "stt.final":
        this.stats.finals += 1;
        this.latency.record("stt", message.latencyMs);
        this.options.onFinal?.(message.text, message.id);
        break;
      case "translation":
        this.stats.translations += 1;
        this.latency.record("translation", message.latency.translationMs);
        this.latency.record("end_to_end", message.latency.endToEndMs);
        this.budget.record({
          endToEndMs: message.latency.endToEndMs,
          translationMs: message.latency.translationMs,
          sttMs: message.latency.sttMs,
          cached: message.cached,
        });
        this.options.onTranslation?.(message);
        break;
      case "tts.start":
        this.activeTts = message;
        break;
      case "tts.end":
        if (this.activeTts?.id === message.id) {
          this.activeTts = null;
        }
        this.latency.record("tts_first_byte", message.firstByteMs);
        break;
      case "error":
        this.lastError = { code: message.code, message: message.message };
        if (!this.everReady) this.failReady(new Error(`${message.code}: ${message.message}`));
        this.options.onError?.(message.message, message.code);
        break;
      case "config.updated":
        this.sourceLang = message.sourceLang;
        this.targetLang = message.targetLang;
        this.ttsMode = message.ttsMode;
        break;
      case "session.stopped":
        this.state = "stopped";
        break;
      case "stats":
      case "pong":
        break;
      default:
        break;
    }
  }

  private handleBinary(data: ArrayBuffer): void {
    this.stats.audioChunks += 1;
    if (this.activeTts) {
      this.options.onAudioChunk?.(data, this.activeTts);
    }
  }
}
