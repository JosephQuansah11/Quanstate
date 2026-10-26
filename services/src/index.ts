/**
 * @quanstate/services — the shared surface consumed by the web app (React) and
 * the Expo app (iOS + Android).  Everything platform-specific is injected:
 * WebSocket factory, microphone capture, speech sink and audio player.
 */

export * from "./languages.js";
export * from "./protocol.js";
export * from "./transport.js";
export * from "./pcm.js";
export * from "./metrics.js";
export * from "./realtime.js";
export * from "./audio.js";
export * from "./learning.js";
export * from "./device.js";
