/** High-level device façade used by the web, iOS and Android applications. */

import { LearningClient, type LearnResponse, type MemoryView, type TranslationResponse } from "./learning";
import { RealtimeSession, type RealtimeSessionOptions } from "./realtime";
import { RealtimeTransport, realtimeUrl, type WebSocketFactory } from "./transport";

export interface DeviceOptions {
  baseUrl?: string;
  profile?: string;
  sourceLang?: string;
  targetLang?: string;
  fetchImpl?: typeof fetch;
  webSocketFactory?: WebSocketFactory;
  reconnect?: boolean;
}

export interface OpenSessionOptions {
  sourceLang?: string;
  targetLang?: string;
  ttsMode?: "client" | "server";
  sampleRate?: number;
  hotwords?: string[];
  onTranslation?: RealtimeSessionOptions["onTranslation"];
  onPartial?: RealtimeSessionOptions["onPartial"];
  onFinal?: RealtimeSessionOptions["onFinal"];
  onAudioChunk?: RealtimeSessionOptions["onAudioChunk"];
  onStatus?: RealtimeSessionOptions["onStatus"];
  onError?: RealtimeSessionOptions["onError"];
  onEvent?: RealtimeSessionOptions["onEvent"];
}

function defaultBaseUrl(): string {
  const globalWindow = globalThis as { location?: { origin?: string } };
  return globalWindow.location?.origin ?? "http://127.0.0.1:8000";
}

export class TranslationDevice {
  readonly baseUrl: string;
  readonly learning: LearningClient;
  readonly profile: string;
  sourceLang: string;
  targetLang: string;

  private readonly webSocketFactory?: WebSocketFactory;
  private readonly reconnect: boolean;

  constructor(options: DeviceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl()).replace(/\/$/, "");
    this.profile = options.profile ?? "default";
    this.sourceLang = options.sourceLang ?? "en";
    this.targetLang = options.targetLang ?? "es";
    this.webSocketFactory = options.webSocketFactory;
    this.reconnect = options.reconnect ?? true;
    this.learning = new LearningClient({ baseUrl: this.baseUrl, fetchImpl: options.fetchImpl });
  }

  async health() {
    return this.learning.health();
  }

  async capabilities() {
    return this.learning.capabilities();
  }

  setLanguages(sourceLang: string, targetLang: string): void {
    this.sourceLang = sourceLang;
    this.targetLang = targetLang;
  }

  createSession(options: OpenSessionOptions = {}): RealtimeSession {
    const sourceLang = options.sourceLang ?? this.sourceLang;
    const targetLang = options.targetLang ?? this.targetLang;
    if (sourceLang === targetLang) {
      throw new Error("Source and target languages must differ");
    }
    this.setLanguages(sourceLang, targetLang);
    const transport = new RealtimeTransport({
      url: realtimeUrl(this.baseUrl),
      factory: this.webSocketFactory,
      reconnect: this.reconnect,
    });
    return new RealtimeSession({
      ...options,
      transport,
      sourceLang,
      targetLang,
      profile: this.profile,
    });
  }

  async openSession(options: OpenSessionOptions = {}): Promise<RealtimeSession> {
    const session = this.createSession(options);
    await session.start();
    return session;
  }

  async translate(text: string, options: { sourceLang?: string; targetLang?: string } = {}): Promise<TranslationResponse> {
    return this.learning.translate(
      text,
      options.sourceLang ?? this.sourceLang,
      options.targetLang ?? this.targetLang,
      this.profile,
    );
  }

  async learnDocument(file: Blob, filename: string, title?: string): Promise<LearnResponse> {
    return this.learning.uploadDocument(file, filename, {
      sourceLang: this.sourceLang,
      targetLang: this.targetLang,
      profile: this.profile,
      title,
    });
  }

  async learnText(text: string, filename = "notes.txt", title?: string): Promise<LearnResponse> {
    return this.learning.learnText(text, {
      sourceLang: this.sourceLang,
      targetLang: this.targetLang,
      profile: this.profile,
      filename,
      title,
    });
  }

  async learnYouTube(url: string, bilingual = true): Promise<LearnResponse> {
    return this.learning.learnYouTube(url, {
      sourceLang: this.sourceLang,
      targetLang: this.targetLang,
      profile: this.profile,
      bilingual,
    });
  }

  async memory(): Promise<MemoryView> {
    return this.learning.memory(this.profile);
  }
}

export function createDevice(options: DeviceOptions = {}): TranslationDevice {
  return new TranslationDevice(options);
}
