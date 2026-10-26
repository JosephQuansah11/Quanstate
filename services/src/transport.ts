/**
 * WebSocket transport with reconnect, backpressure and platform adapters.
 *
 * Browsers, React Native and Node all expose a compatible WebSocket shape; the
 * factory is injectable so tests (and native apps that need a polyfill) can
 * supply their own.  Audio frames are never queued while offline -- stale
 * microphone data is worse than dropped data.
 */

import { encodeClientMessage, type ClientMessage } from "./protocol";

export type TransportStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface WebSocketLike {
  readyState: number;
  binaryType?: string;
  send(data: string | ArrayBufferLike | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ReconnectOptions {
  minDelayMs: number;
  maxDelayMs: number;
  factor: number;
  maxAttempts: number;
}

export interface TransportOptions {
  url: string;
  factory?: WebSocketFactory;
  reconnect?: boolean | Partial<ReconnectOptions>;
  maxQueue?: number;
  pingIntervalMs?: number;
}

const defaultReconnect: ReconnectOptions = {
  minDelayMs: 250,
  maxDelayMs: 8_000,
  factor: 1.8,
  maxAttempts: 8,
};

type MessageHandler = (raw: string) => void;
type BinaryHandler = (data: ArrayBuffer) => void;
type StatusHandler = (status: TransportStatus) => void;

export class RealtimeTransport {
  readonly url: string;
  private readonly factory: WebSocketFactory;
  private readonly reconnectOptions: ReconnectOptions | null;
  private readonly maxQueue: number;
  private readonly pingIntervalMs: number;

  private socket: WebSocketLike | null = null;
  private queue: string[] = [];
  private messageHandlers = new Set<MessageHandler>();
  private binaryHandlers = new Set<BinaryHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private pendingPings = new Set<number>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private manualClose = false;

  status: TransportStatus = "idle";
  droppedAudioFrames = 0;
  rttMs = 0;

  constructor(options: TransportOptions) {
    this.url = options.url;
    this.factory = options.factory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.reconnectOptions =
      options.reconnect === false
        ? null
        : { ...defaultReconnect, ...(typeof options.reconnect === "object" ? options.reconnect : {}) };
    this.maxQueue = options.maxQueue ?? 64;
    this.pingIntervalMs = options.pingIntervalMs ?? 15_000;
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onBinary(handler: BinaryHandler): () => void {
    this.binaryHandlers.add(handler);
    return () => this.binaryHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  connect(): Promise<void> {
    this.manualClose = false;
    if (this.status === "open") return Promise.resolve();
    this.setStatus("connecting");

    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = this.factory(this.url);
      this.socket = socket;
      socket.binaryType = "arraybuffer";

      socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus("open");
        this.flushQueue();
        this.startPing();
        settled = true;
        resolve();
      };
      socket.onmessage = (event) => this.handleIncoming(event.data);
      socket.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket connection failed"));
        }
      };
      socket.onclose = () => {
        this.stopPing();
        this.socket = null;
        if (this.manualClose) {
          this.setStatus("closed");
          return;
        }
        this.scheduleReconnect();
      };
    });
  }

  send(message: ClientMessage | string): boolean {
    const payload = typeof message === "string" ? message : encodeClientMessage(message);
    if (this.status === "open" && this.socket) {
      this.socket.send(payload);
      return true;
    }
    if (this.queue.length >= this.maxQueue) {
      this.queue.shift();
    }
    this.queue.push(payload);
    return false;
  }

  sendAudio(frame: Uint8Array): boolean {
    if (this.status !== "open" || !this.socket) {
      this.droppedAudioFrames += 1;
      return false;
    }
    this.socket.send(frame);
    return true;
  }

  ping(): number {
    const token = Date.now();
    this.pendingPings.add(token);
    this.send({ type: "ping", t: token });
    return token;
  }

  close(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.socket?.close();
    this.socket = null;
    this.queue = [];
    this.setStatus("closed");
  }

  private flushQueue(): void {
    if (!this.socket) return;
    const pending = this.queue;
    this.queue = [];
    for (const payload of pending) {
      this.socket.send(payload);
    }
  }

  private handleIncoming(data: unknown): void {
    if (typeof data === "string") {
      this.trackPong(data);
      for (const handler of this.messageHandlers) handler(data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      for (const handler of this.binaryHandlers) handler(data);
      return;
    }
    if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      const start = view.byteOffset;
      const copy = view.buffer.slice(start, start + view.byteLength);
      for (const handler of this.binaryHandlers) handler(copy as ArrayBuffer);
      return;
    }
    const blobLike = data as { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (typeof blobLike?.arrayBuffer === "function") {
      void blobLike.arrayBuffer().then((buffer) => {
        for (const handler of this.binaryHandlers) handler(buffer);
      });
    }
  }

  private trackPong(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as { type?: string; t?: number };
      if (parsed.type === "pong" && typeof parsed.t === "number" && this.pendingPings.has(parsed.t)) {
        this.rttMs = Math.max(0, Date.now() - parsed.t);
        this.pendingPings.delete(parsed.t);
      }
    } catch {
      /* non-JSON text frame: ignore */
    }
  }

  private startPing(): void {
    this.stopPing();
    if (this.pingIntervalMs <= 0) return;
    this.pingTimer = setInterval(() => this.ping(), this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnectOptions) {
      this.setStatus("closed");
      return;
    }
    if (this.reconnectAttempts >= this.reconnectOptions.maxAttempts) {
      this.setStatus("closed");
      return;
    }
    this.setStatus("reconnecting");
    const delay = Math.min(
      this.reconnectOptions.maxDelayMs,
      this.reconnectOptions.minDelayMs * this.reconnectOptions.factor ** this.reconnectAttempts,
    );
    const jitter = delay * (0.75 + Math.random() * 0.5);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => this.scheduleReconnect());
    }, jitter);
  }

  private setStatus(status: TransportStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }
}

export function realtimeUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
    return `${trimmed}/v1/realtime`;
  }
  const secure = trimmed.startsWith("https://");
  return `${trimmed.replace(/^https?:\/\//, secure ? "wss://" : "ws://")}/v1/realtime`;
}
