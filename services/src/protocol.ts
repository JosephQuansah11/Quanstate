/**
 * Wire protocol shared by web, iOS and Android clients.
 *
 * Control frames are JSON; microphone audio is raw little-endian PCM16 mono
 * binary at the negotiated sample rate (16 kHz default).  Keeping audio out of
 * JSON avoids base64 overhead on the hot path.
 */

export const PROTOCOL_VERSION = 1;

export interface EngineInfo {
  translation: string;
  speechToText: string;
  textToSpeech: string;
}

export interface SessionBudget {
  fastPathMs: number;
  endToEndMs: number;
  frameMs: number;
}

export interface MemoryInfo {
  version: number;
  phrases: number;
  learnedPhrases?: number;
  glossary: number;
  documents: number;
  hotwords: number;
}

export interface SessionReady {
  type: "session.ready";
  protocolVersion: number;
  sessionId: string;
  sourceLang: string;
  targetLang: string;
  sampleRate: number;
  ttsMode: "client" | "server";
  profile: string;
  engines: EngineInfo;
  capabilities: Record<string, unknown>;
  memory: MemoryInfo;
  budget: SessionBudget;
  hotwords: string[];
}

export interface SttPartial {
  type: "stt.partial";
  id: string;
  text: string;
  language: string;
  confidence: number;
  latencyMs: number;
  engine: string;
}

export interface SttFinal {
  type: "stt.final";
  id: string;
  text: string;
  language: string;
  confidence: number;
  startMs: number;
  endMs: number;
  latencyMs: number;
  engine: string;
}

export interface StageLatency {
  sttMs: number;
  translationMs: number;
  endToEndMs: number;
  budgetMs: number;
}

export interface TranslationEvent {
  type: "translation";
  id: string;
  sourceText: string;
  text: string;
  sourceLang: string;
  targetLang: string;
  engine: string;
  cached: boolean;
  confidence: number;
  coverage: number;
  glossaryHits: string[];
  latency: StageLatency;
}

export interface TtsStart {
  type: "tts.start";
  id: string;
  segmentId: string;
  voice: string;
  format: "pcm16";
  sampleRate: number;
  text: string;
}

export interface TtsEnd {
  type: "tts.end";
  id: string;
  segmentId: string;
  chunks: number;
  firstByteMs: number;
  durationMs: number;
  voice: string;
}

export interface StatsEvent {
  type: "stats";
  sessionId: string;
  latency: {
    stages: Record<string, { count: number; p50: number; p95: number; p99: number; max: number }>;
    budget: { ok: boolean; violations: Array<{ stage: string; p95: number; budgetMs: number }> };
    counters: Record<string, number>;
  };
  counters: Record<string, number>;
  queueDepth: number;
  streaming: boolean;
}

export interface PongEvent {
  type: "pong";
  t: number | null;
  serverTime: number;
}

export interface ConfigUpdated {
  type: "config.updated";
  sourceLang: string;
  targetLang: string;
  ttsMode: "client" | "server";
  hotwords: string[];
}

export interface SessionStopped {
  type: "session.stopped";
}

export interface ServerErrorEvent {
  type: "error";
  code: string;
  message: string;
  recoverable: boolean;
}

export type ServerMessage =
  | SessionReady
  | SttPartial
  | SttFinal
  | TranslationEvent
  | TtsStart
  | TtsEnd
  | StatsEvent
  | PongEvent
  | ConfigUpdated
  | SessionStopped
  | ServerErrorEvent;

export type ServerMessageType = ServerMessage["type"];

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

const KNOWN_TYPES: ReadonlySet<string> = new Set<ServerMessageType>([
  "session.ready",
  "stt.partial",
  "stt.final",
  "translation",
  "tts.start",
  "tts.end",
  "stats",
  "pong",
  "config.updated",
  "session.stopped",
  "error",
]);

export interface SessionStartOptions {
  sourceLang: string;
  targetLang: string;
  sampleRate?: number;
  ttsMode?: "client" | "server";
  profile?: string;
  sessionId?: string;
  features?: { onDeviceStt?: boolean };
  hotwords?: string[];
  localeHint?: string;
}

export type ClientMessage =
  | ({ type: "session.start" } & SessionStartOptions)
  | { type: "text.input"; text: string; id?: string }
  | { type: "audio.flush" }
  | {
      type: "config.update";
      sourceLang?: string;
      targetLang?: string;
      ttsMode?: "client" | "server";
      hotwords?: string[];
    }
  | { type: "ping"; t: number }
  | { type: "session.stop" };

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

export function parseServerMessage(raw: string): ServerMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProtocolError("Server sent invalid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError("Server message must be an object");
  }
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
    throw new ProtocolError(`Unknown server message type: ${String(type)}`);
  }
  switch (type) {
    case "session.ready":
      requireStrings(record, ["sessionId", "sourceLang", "targetLang", "profile"]);
      requireNumbers(record, ["sampleRate", "protocolVersion"]);
      return record as unknown as SessionReady;
    case "stt.partial":
      requireStrings(record, ["id", "text", "language"]);
      return record as unknown as SttPartial;
    case "stt.final":
      requireStrings(record, ["id", "text", "language"]);
      return record as unknown as SttFinal;
    case "translation":
      requireStrings(record, ["id", "sourceText", "text", "sourceLang", "targetLang"]);
      if (typeof record.latency !== "object" || record.latency === null) {
        throw new ProtocolError("translation.latency is required");
      }
      return record as unknown as TranslationEvent;
    case "tts.start":
      requireStrings(record, ["id", "segmentId", "voice"]);
      requireNumbers(record, ["sampleRate"]);
      return record as unknown as TtsStart;
    case "tts.end":
      requireStrings(record, ["id", "segmentId"]);
      return record as unknown as TtsEnd;
    case "stats":
      requireStrings(record, ["sessionId"]);
      return record as unknown as StatsEvent;
    case "pong":
      return record as unknown as PongEvent;
    case "config.updated":
      requireStrings(record, ["sourceLang", "targetLang"]);
      return record as unknown as ConfigUpdated;
    case "session.stopped":
      return record as unknown as SessionStopped;
    case "error":
      requireStrings(record, ["code", "message"]);
      return record as unknown as ServerErrorEvent;
    default:
      throw new ProtocolError(`Unhandled server message type: ${type}`);
  }
}

function requireStrings(record: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    if (typeof record[key] !== "string") {
      throw new ProtocolError(`Missing or invalid string field: ${key}`);
    }
  }
}

function requireNumbers(record: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    if (typeof record[key] !== "number" || Number.isNaN(record[key])) {
      throw new ProtocolError(`Missing or invalid number field: ${key}`);
    }
  }
}

export function isErrorEvent(message: ServerMessage): message is ServerErrorEvent {
  return message.type === "error";
}

export function sessionStartMessage(options: SessionStartOptions): ClientMessage {
  return {
    type: "session.start",
    sampleRate: 16_000,
    ttsMode: "client",
    profile: "default",
    ...options,
  };
}
