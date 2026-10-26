import { describe, expect, it } from "vitest";

import { RealtimeSession } from "../src/realtime";
import { RealtimeTransport } from "../src/transport";
import { FakeWebSocket, readyPayload } from "./fakes";

async function liveSession(onError?: (message: string, code: string) => void) {
  FakeWebSocket.instances = [];
  const partials: string[] = [];
  const finals: string[] = [];
  const translations: string[] = [];
  const audio: Array<{ meta: string; bytes: number }> = [];
  const session = new RealtimeSession({
    transport: new RealtimeTransport({
      url: "ws://localhost/v1/realtime",
      factory: (url) => new FakeWebSocket(url),
      reconnect: false,
      pingIntervalMs: 0,
    }),
    sourceLang: "en",
    targetLang: "es",
    onPartial: (text) => partials.push(text),
    onFinal: (text) => finals.push(text),
    onTranslation: (event) => translations.push(event.text),
    onAudioChunk: (chunk, meta) => audio.push({ meta: meta.voice, bytes: chunk.byteLength }),
    onError,
  });
  const starting = session.start();
  const socket = FakeWebSocket.instances[0]!;
  socket.open();
  socket.serverMessage(readyPayload);
  const ready = await starting;
  return { session, socket, ready, partials, finals, translations, audio };
}

describe("RealtimeSession", () => {
  it("starts a session and exposes server capabilities", async () => {
    const { session, socket, ready } = await liveSession();
    expect(ready.sourceLang).toBe("en");
    expect(ready.targetLang).toBe("es");
    expect(session.state).toBe("live");
    expect(session.ready?.engines.translation).toBe("memory+cache");
    const start = socket.sentJson().find((message) => message.type === "session.start");
    expect(start).toMatchObject({ sourceLang: "en", targetLang: "es", sampleRate: 16000 });
    session.dispose();
  });

  it("routes speech, translation and streamed audio events", async () => {
    const { session, socket, partials, finals, translations, audio } = await liveSession();
    socket.serverMessage({
      type: "stt.partial",
      id: "u1",
      text: "where is the",
      language: "en",
      confidence: 0.4,
      latencyMs: 12,
      engine: "whisper",
    });
    socket.serverMessage({
      type: "stt.final",
      id: "u1",
      text: "where is the bathroom?",
      language: "en",
      confidence: 0.98,
      startMs: 0,
      endMs: 900,
      latencyMs: 30,
      engine: "whisper",
    });
    socket.serverMessage({
      type: "translation",
      id: "u1",
      sourceText: "where is the bathroom?",
      text: "¿dónde está el baño?",
      sourceLang: "en",
      targetLang: "es",
      engine: "memory+cache:cache",
      cached: true,
      confidence: 1,
      coverage: 1,
      glossaryHits: [],
      latency: { sttMs: 30, translationMs: 0.4, endToEndMs: 2.1, budgetMs: 100 },
    });
    socket.serverMessage({
      type: "tts.start",
      id: "t1",
      segmentId: "u1",
      voice: "tone",
      format: "pcm16",
      sampleRate: 16000,
      text: "¿dónde está el baño?",
    });
    socket.serverBinary(new Uint8Array(640).buffer);
    socket.serverMessage({
      type: "tts.end",
      id: "t1",
      segmentId: "u1",
      chunks: 1,
      firstByteMs: 3.2,
      durationMs: 810,
      voice: "tone",
    });

    expect(partials).toEqual(["where is the"]);
    expect(finals).toEqual(["where is the bathroom?"]);
    expect(translations).toEqual(["¿dónde está el baño?"]);
    expect(audio).toEqual([{ meta: "tone", bytes: 640 }]);
    expect(session.stats).toMatchObject({ partials: 1, finals: 1, translations: 1, audioChunks: 1 });
    const report = session.budget.report();
    expect(report.samples).toBe(1);
    expect(report.cacheHitRate).toBe(1);
    expect(report.withinBudget).toBe(true);
    session.dispose();
  });

  it("sends audio, text and config updates over the socket", async () => {
    const { session, socket } = await liveSession();
    expect(session.pushAudio(new Uint8Array(640))).toBe(true);
    session.sendText("hello");
    session.setLanguages("en", "fr");
    session.setTtsMode("server");
    const types = socket.sentJson().map((message) => message.type);
    expect(types).toContain("text.input");
    expect(types).toContain("config.update");
    const update = socket.sentJson().filter((message) => message.type === "config.update").at(-1);
    expect(update).toMatchObject({ ttsMode: "server" });
    session.dispose();
  });

  it("surfaces server errors", async () => {
    let seen: { message: string; code: string } | undefined;
    const { session, socket } = await liveSession((message, code) => {
      seen = { message, code };
    });
    socket.serverMessage({ type: "error", code: "translation_failed", message: "provider down", recoverable: true });
    expect(seen).toEqual({ message: "provider down", code: "translation_failed" });
    expect(session.lastError?.message).toBe("provider down");
    session.dispose();
  });
});
