import { describe, expect, it, vi } from "vitest";

import { RealtimeTransport, realtimeUrl } from "../src/transport";
import { FakeWebSocket } from "./fakes";

function makeTransport(reconnect: boolean | object = false, pingIntervalMs = 0): RealtimeTransport {
  return new RealtimeTransport({
    url: realtimeUrl("http://localhost:8000"),
    factory: (url) => new FakeWebSocket(url),
    reconnect,
    pingIntervalMs,
  });
}

describe("RealtimeTransport", () => {
  it("builds ws/wss urls from http bases", () => {
    expect(realtimeUrl("http://localhost:8000")).toBe("ws://localhost:8000/v1/realtime");
    expect(realtimeUrl("https://api.example.com/")).toBe("wss://api.example.com/v1/realtime");
    expect(realtimeUrl("ws://127.0.0.1:9000")).toBe("ws://127.0.0.1:9000/v1/realtime");
  });

  it("queues control frames until the socket opens, then flushes", async () => {
    FakeWebSocket.instances = [];
    const transport = makeTransport();
    const connecting = transport.connect();
    const socket = FakeWebSocket.instances[0]!;
    expect(transport.status).toBe("connecting");
    expect(transport.send({ type: "ping", t: 1 })).toBe(false);
    socket.open();
    await connecting;
    expect(transport.status).toBe("open");
    expect(socket.sentJson()).toEqual([{ type: "ping", t: 1 }]);
    socket.remoteClose();
  });

  it("drops microphone audio instead of queueing stale frames", async () => {
    FakeWebSocket.instances = [];
    const transport = makeTransport();
    const connecting = transport.connect();
    const socket = FakeWebSocket.instances[0]!;
    expect(transport.sendAudio(new Uint8Array(320))).toBe(false);
    expect(transport.droppedAudioFrames).toBe(1);
    socket.open();
    await connecting;
    expect(transport.sendAudio(new Uint8Array(640))).toBe(true);
    expect(socket.sent.at(-1)).toBeInstanceOf(Uint8Array);
    socket.remoteClose();
  });

  it("measures round-trip time from pong frames", async () => {
    FakeWebSocket.instances = [];
    const transport = makeTransport();
    const connecting = transport.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await connecting;
    const token = transport.ping();
    const pingMessage = socket.sentJson().at(-1);
    expect(pingMessage).toMatchObject({ type: "ping", t: token });
    socket.serverMessage({ type: "pong", t: token, serverTime: 1 });
    expect(transport.rttMs).toBeGreaterThanOrEqual(0);
    expect(transport.rttMs).toBeLessThan(1_000);
    socket.remoteClose();
  });

  it("reconnects with backoff after an unexpected drop", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const statuses: string[] = [];
    const transport = makeTransport({ minDelayMs: 1, maxDelayMs: 5, factor: 2, maxAttempts: 2 });
    transport.onStatus((status) => statuses.push(status));
    const connecting = transport.connect();
    const first = FakeWebSocket.instances[0]!;
    first.open();
    await connecting;
    first.remoteClose();
    expect(transport.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(20);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.status).toBe("open");
    expect(statuses).toContain("reconnecting");
    transport.close();
    vi.useRealTimers();
  });

  it("does not reconnect after an explicit close", async () => {
    FakeWebSocket.instances = [];
    const transport = makeTransport({ minDelayMs: 1, maxDelayMs: 2, factor: 1, maxAttempts: 3 });
    const connecting = transport.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await connecting;
    transport.close();
    socket.remoteClose();
    expect(transport.status).toBe("closed");
  });
});
