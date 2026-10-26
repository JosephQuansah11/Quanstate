/**
 * Cross-language smoke test: drives the real Python service through the same
 * @quanstate/services SDK the web and mobile apps use.
 *
 *   npm run build --workspace @quanstate/services
 *   cd api && uvicorn quanstate.server:app --port 8000 &
 *   node scripts/e2e-client.mjs http://127.0.0.1:8000
 */
import { createDevice } from "../services/dist/index.js";

const baseUrl = (process.argv[2] ?? process.env.API_BASE ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const device = createDevice({ baseUrl, profile: "e2e" });

function withTimeout(promise, label, ms = 12_000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms)),
  ]);
}

const health = await withTimeout(device.health(), "health");
console.log("health", health.status, health.engines);

const translations = [];
const waitForTranslation = () =>
  new Promise((resolve) => {
    const timer = setInterval(() => {
      if (translations.length) {
        clearInterval(timer);
        resolve(translations.shift());
      }
    }, 5);
  });

const live = await withTimeout(
  device.openSession({
    sourceLang: "en",
    targetLang: "es",
    onTranslation: (event) => translations.push(event),
  }),
  "live session",
);

const roundTrips = [];
let cached = 0;
for (const text of ["hello", "where is the bathroom?", "hello", "thank you", "hello"]) {
  const started = performance.now();
  const pending = waitForTranslation();
  live.sendText(text);
  const event = await withTimeout(pending, `translation:${text}`);
  roundTrips.push(performance.now() - started);
  if (event.cached) cached += 1;
  console.log("translate", JSON.stringify(text), "->", JSON.stringify(event.text), `${event.latency.translationMs}ms`);
}

const learned = await withTimeout(
  device.learning.learnText("the rollout window = la ventana de despliegue", {
    sourceLang: "en",
    targetLang: "es",
    profile: "e2e",
    filename: "glossary.txt",
  }),
  "learning",
);
console.log("learned", learned.document.phrasesAdded, "pairs");
const afterLearning = await withTimeout(device.translate("the rollout window"), "post-learning translation");
console.log("post-learning", JSON.stringify(afterLearning.text));

const wav = await withTimeout(device.learning.tts("hola mundo", "es"), "tts");
const wavBytes = new Uint8Array(wav);
console.log("tts", wavBytes.byteLength, "bytes, RIFF:", String.fromCharCode(...wavBytes.slice(0, 4)));

const memory = await withTimeout(device.memory(), "memory");
console.log("memory", memory.stats);

live.stop();

const p95 = roundTrips.sort((a, b) => a - b)[Math.ceil(roundTrips.length * 0.95) - 1];
console.log(
  JSON.stringify({ roundTrips: roundTrips.map((value) => Math.round(value * 100) / 100), p95: Math.round(p95 * 100) / 100, cached }),
);
if (!translations.length && afterLearning.text !== "la ventana de despliegue") {
  throw new Error("learning did not take effect");
}
if (String.fromCharCode(...wavBytes.slice(0, 4)) !== "RIFF") throw new Error("TTS did not return WAV");
if (wavBytes.byteLength < 10_000) throw new Error("TTS audio too small");
if (p95 > 500) throw new Error(`round trip too slow: ${p95} ms`);
if (cached < 1) throw new Error("expected at least one cached translation");
console.log("E2E OK");
