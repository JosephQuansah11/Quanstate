import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const dist = `${repoRoot}/apps/web/dist`;
const html = readFileSync(`${dist}/index.html`, "utf8");
const asset = readdirSync(`${dist}/assets`).find((name) => name.endsWith(".js"));
if (!asset) throw new Error("no built asset");

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:5173/",
  pretendToBeVisual: true,
});
const { window } = dom;
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event", "MouseEvent", "CustomEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "ResizeObserver", "Blob", "File", "FormData", "AudioContext"]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "self", { value: window, configurable: true, writable: true });
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("/v1/health")) return Response.json({ status: "ok", service: "quanstate", version: "1.0.0", uptimeSeconds: 1, engines: { translation: "memory+cache", speechToText: "none", textToSpeech: "tone" } });
  if (url.includes("/v1/capabilities")) return Response.json({ protocolVersion: 1, engines: { translation: "memory+cache", speechToText: "none", textToSpeech: "tone" }, capabilities: {} });
  if (url.includes("/v1/memory")) return Response.json({ profile: "default", version: 1, stats: { phrases: 158, learnedPhrases: 0, glossary: 0, documents: 0, hotwords: 0 }, documents: [], glossary: [], hotwords: {} });
  return new Response("not found", { status: 404 });
};

await import(`file://${dist}/assets/${asset}`);
await new Promise((resolve) => setTimeout(resolve, 600));
const text = dom.window.document.body.textContent.replace(/\s+/g, " ");
console.log("BODY:", text.slice(0, 400));
for (const expected of ["Quanstate", "I speak", "Translate into", "Start translating"]) {
  if (!text.includes(expected)) throw new Error(`missing UI text: ${expected}`);
}
console.log("WEB SMOKE OK", asset, "html bytes", html.length);

process.exit(0);
