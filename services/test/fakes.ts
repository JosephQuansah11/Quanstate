import type { WebSocketLike } from "../src/transport";

type Handler<T> = ((event: T) => void) | null;

/** Minimal in-memory WebSocket used by transport/session tests. */
export class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  binaryType = "arraybuffer";
  sent: Array<string | ArrayBufferLike | Uint8Array> = [];
  closed = false;

  onopen: Handler<unknown> = null;
  onclose: Handler<{ code?: number; reason?: string }> = null;
  onerror: Handler<unknown> = null;
  onmessage: Handler<{ data: unknown }> = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  serverMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverBinary(data: ArrayBuffer): void {
    this.onmessage?.({ data });
  }

  remoteClose(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }

  sentJson(): Array<Record<string, unknown>> {
    return this.sent
      .filter((item): item is string => typeof item === "string")
      .map((item) => JSON.parse(item) as Record<string, unknown>);
  }
}

export const readyPayload = {
  type: "session.ready",
  protocolVersion: 1,
  sessionId: "sess_test",
  sourceLang: "en",
  targetLang: "es",
  sampleRate: 16000,
  ttsMode: "client",
  profile: "default",
  engines: { translation: "memory+cache", speechToText: "none", textToSpeech: "tone" },
  capabilities: {},
  memory: { version: 1, phrases: 158, glossary: 0, documents: 0, hotwords: 0 },
  budget: { fastPathMs: 5, endToEndMs: 100, frameMs: 20 },
  hotwords: [],
};
