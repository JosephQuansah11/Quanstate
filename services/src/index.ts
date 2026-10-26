/**
 * @quanstate/services — the shared surface consumed by the web app (React) and
 * the Expo app (iOS + Android).  Everything platform-specific is injected:
 * WebSocket factory, microphone capture, speech sink and audio player.
 */

export * from "./languages";
export * from "./protocol";
export * from "./transport";
export * from "./pcm";
export * from "./metrics";
export * from "./realtime";
export * from "./audio";
export * from "./learning";
export * from "./device";
