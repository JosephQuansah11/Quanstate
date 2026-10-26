/**
 * Runtime smoke test for the built web client's live screen.
 * Boots the real bundle in jsdom with a fake WebSocket + fetch layer, then
 * checks the session handshake, protocol dispatch and translation rendering.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const dist = `${repoRoot}/apps/web/dist`;
const asset = readdirSync(`${dist}/assets`).find((name) => name.endsWith(".js"));
if (!asset) throw new Error("no built asset");

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:5173/",
  pretendToBeVisual: true,
});
const { window } = dom;
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "CustomEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "ResizeObserver", "Blob", "File", "FormData"]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "self", { value: window, configurable: true, writable: true });

window.localStorage.setItem(
  "quanstate.settings.v1",
  JSON.stringify({ sourceLang: "en", targetLang: "es", ttsMode: "client", inputMode: "typed", autoSpeak: false, paired: true }),
);

globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("/v1/health")) return Response.json({ status: "ok", service: "quanstate", version: "1.0.0", uptimeSeconds: 1, engines: { translation: "memory+cache", speechToText: "none", textToSpeech: "tone" } });
  if (url.includes("/v1/capabilities")) return Response.json({ protocolVersion: 1, engines: { translation: "memory+cache", speechToText: "none", textToSpeech: "tone" }, capabilities: {} });
  if (url.includes("/v1/memory")) return Response.json({ profile: "default", version: 1, stats: { phrases: 158, learnedPhrases: 0, glossary: 0, documents: 0, hotwords: 0 }, documents: [], glossary: [], hotwords: {} });
  return new Response("not found", { status: 404 });
};

const ready = {
  type: "session.ready",
  protocolVersion: 1,
  sessionId: "sess_smoke",
  sourceLang: "en",
  targetLang: "es",
  sampleRate: 16000,
  ttsMode: "client",
  profile: "default",
  engines: { translation: "memory+cache", speechToText: "none", textToSpeech: "tone" },
  capabilities: {},
  memory: { version: 1, phrases: 158, learnedPhrases: 0, glossary: 0, documents: 0, hotwords: 0 },
  budget: { fastPathMs: 5, endToEndMs: 100, frameMs: 20 },
  hotwords: [],
};

class FakeWebSocket {
  constructor() {
    this.readyState = 0;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 0);
  }
  send(payload) {
    if (typeof payload !== "string") return;
    const message = JSON.parse(payload);
    if (message.type === "session.start") {
      setTimeout(() => this.onmessage?.({ data: JSON.stringify(ready) }), 5);
    } else if (message.type === "text.input") {
      setTimeout(() => {
        this.onmessage?.({ data: JSON.stringify({ type: "stt.final", id: "utt_smoke", text: message.text, language: "en", confidence: 1, startMs: 0, endMs: 500, latencyMs: 0, engine: "client" }) });
        this.onmessage?.({ data: JSON.stringify({ type: "translation", id: "utt_smoke", sourceText: message.text, text: "hola", sourceLang: "en", targetLang: "es", engine: "memory+cache:cache", cached: true, confidence: 1, coverage: 1, glossaryHits: [], latency: { sttMs: 0, translationMs: 0.02, endToEndMs: 0.4, budgetMs: 100 } }) });
      }, 5);
    } else if (message.type === "ping") {
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: "pong", t: message.t, serverTime: 1 }) }), 1);
    }
  }
  close() { this.readyState = 3; }
}
Object.defineProperty(globalThis, "WebSocket", { value: FakeWebSocket, configurable: true, writable: true });

await import(`file://${dist}/assets/${asset}`);
await new Promise((resolve) => setTimeout(resolve, 250));

let text = document.body.textContent.replace(/\s+/g, " ");
if (!text.includes("Tap to speak")) throw new Error(`live screen did not render: ${text.slice(0, 200)}`);
if (!text.includes("Ready")) throw new Error("session did not become ready");

const input = document.querySelector(".type-form input");
if (!input) throw new Error("missing typed input");
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
setter.call(input, "hello");
input.dispatchEvent(new window.Event("input", { bubbles: true }));
const form = document.querySelector(".type-form");
form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
await new Promise((resolve) => setTimeout(resolve, 150));

text = document.body.textContent.replace(/\s+/g, " ");
if (!text.includes("hola")) throw new Error(`translation not rendered: ${text.slice(0, 300)}`);
if (!text.includes("cached")) throw new Error("cache badge not rendered");
console.log("WEB LIVE SMOKE OK", asset);
process.exit(0);
