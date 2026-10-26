import { describe, expect, it } from "vitest";

import {
  ProtocolError,
  encodeClientMessage,
  parseServerMessage,
  sessionStartMessage,
  type ClientMessage,
} from "../src/protocol";
import { readyPayload } from "./fakes";

describe("protocol", () => {
  it("encodes a session start with sane defaults", () => {
    const message = sessionStartMessage({ sourceLang: "en", targetLang: "es" });
    expect(message).toMatchObject({
      type: "session.start",
      sampleRate: 16000,
      ttsMode: "client",
      profile: "default",
    });
    expect(JSON.parse(encodeClientMessage(message))).toEqual(message);
  });

  it("parses every server event the pipeline emits", () => {
    const messages = [
      readyPayload,
      { type: "stt.partial", id: "u1", text: "hello", language: "en", confidence: 0.4, latencyMs: 12, engine: "whisper" },
      { type: "stt.final", id: "u1", text: "hello", language: "en", confidence: 1, startMs: 0, endMs: 400, latencyMs: 20, engine: "whisper" },
      {
        type: "translation",
        id: "u1",
        sourceText: "hello",
        text: "hola",
        sourceLang: "en",
        targetLang: "es",
        engine: "memory",
        cached: false,
        confidence: 1,
        coverage: 1,
        glossaryHits: [],
        latency: { sttMs: 20, translationMs: 0.2, endToEndMs: 3.4, budgetMs: 100 },
      },
      { type: "tts.start", id: "t1", segmentId: "u1", voice: "tone", format: "pcm16", sampleRate: 16000, text: "hola" },
      { type: "tts.end", id: "t1", segmentId: "u1", chunks: 2, firstByteMs: 4, durationMs: 120, voice: "tone" },
      { type: "stats", sessionId: "s", latency: { stages: {}, budget: { ok: true, violations: [] }, counters: {} }, counters: {}, queueDepth: 0, streaming: true },
      { type: "pong", t: 1, serverTime: 5 },
      { type: "config.updated", sourceLang: "en", targetLang: "fr", ttsMode: "server", hotwords: [] },
      { type: "session.stopped" },
      { type: "error", code: "bad_message", message: "nope", recoverable: true },
    ];
    for (const message of messages) {
      expect(parseServerMessage(JSON.stringify(message)).type).toBe(message.type);
    }
  });

  it("rejects malformed or unknown messages", () => {
    expect(() => parseServerMessage("not json")).toThrow(ProtocolError);
    expect(() => parseServerMessage("[]")).toThrow(/object/);
    expect(() => parseServerMessage(JSON.stringify({ type: "nope" }))).toThrow(/Unknown server message/);
    expect(() => parseServerMessage(JSON.stringify({ type: "translation", id: "x" }))).toThrow(/Missing/);
  });

  it("validates client message shape at compile time and runtime", () => {
    const message: ClientMessage = { type: "text.input", text: "hello" };
    expect(JSON.parse(encodeClientMessage(message))).toEqual({ type: "text.input", text: "hello" });
  });
});
