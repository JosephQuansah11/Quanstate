# Quanstate — a realtime translation device

Quanstate turns any phone or browser into a two-way interpreter: choose the language you speak and the language you
want to hear, talk naturally, and see + hear the translation in real time. It keeps learning from the documents and
YouTube videos you feed it, and it runs as one service shared by **web, iOS and Android**.

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  Web (React + Vite)          │        │  iOS / Android (Expo)        │
│  @quanstate/services         │        │  @quanstate/services         │
│  mic → 20 ms PCM frames      │        │  native STT + native TTS     │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │  WebSocket /v1/realtime (JSON + PCM16)│
               ▼                                       ▼
┌───────────────────────────────────────────────────────────────────────┐
│ Python service (FastAPI + asyncio)                                    │
│  VAD → speech-to-text → translation memory + cache → TTS              │
│  learning: documents / YouTube captions → phrases, glossary, hotwords │
└───────────────────────────────────────────────────────────────────────┘
```

## What is implemented

- **Language pairing on entry** — searchable catalogue of 21 languages (native names, RTL metadata, BCP-47 codes).
- **Realtime duplex pipeline** — raw 16 kHz PCM16 over a binary WebSocket, energy VAD with pre-roll, one inference
  worker per session, backpressure with a bounded queue, automatic reconnect on the client.
- **Speech to text** — `faster-whisper` (CPU int8) or any OpenAI-compatible `/v1/audio/transcriptions` endpoint, with
  rolling partial hypotheses while a person is still speaking; a deterministic scripted engine for tests/demos.
- **Translation** — versioned, sub-millisecond translation memory (seeded phrasebook + everything learned), LRU cache,
  glossary protection, word-level fallback for en↔es/fr/de, and opt-in NLLB-200 or LibreTranslate providers.
- **Text to speech** — native device voice by default (near-zero added latency), or streamed server PCM from Piper or
  the bundled formant synthesizer (`/v1/tts` also returns WAV for integrations).
- **Learning that takes effect immediately** — upload `.txt/.md/.srt/.vtt/.csv/.tsv/.json/.html/.docx/.pdf` or a
  YouTube URL. Extracts parallel phrases (`a = b`, `a | b`, tabs), protects terminology, mines domain hotwords for STT, and invalidates the translation cache atomically.
- **Telemetry built in** — per-stage percentiles, end-to-end p50/p95/max, cache-hit rate, dropped-frame counters and a
  declarative latency budget enforced by tests.

## Repository layout

```
api/                 Python 3.11 service (FastAPI, WebSocket, engines, learning, tests)
services/            @quanstate/services — shared TypeScript protocol, transport, audio, speech, learning SDK
apps/web/            React 19 + TypeScript + Vite web client (AudioWorklet capture, Web Speech, PCM playback)
apps/mobile/         Expo / React Native client for iOS + Android (native STT/TTS, document picker)
docs/                ARCHITECTURE.md, PROTOCOL.md
```

## Quick start

### 1. Service

```bash
cd api
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn quanstate.server:app --reload --port 8000
```

Open <http://127.0.0.1:8000/docs> for the REST API and <http://127.0.0.1:8000/v1/health> for health. The service also
serves the production web build from `apps/web/dist` when it exists, so one process can host everything.

### 2. Web

```bash
npm install          # from the repo root (workspaces: services, web, mobile)
npm run build --workspace @quanstate/services
npm run dev:web      # http://localhost:5173, proxies /v1 (including WebSocket) to :8000
```

Allow microphone access, pick “I speak” / “Translate into”, and tap the orb. If the service has no server STT engine
configured, the web app uses your browser's recognizer and still streams microphone audio to the pipeline for VAD,
learning and telemetry.

### 3. iOS / Android

```bash
cd apps/mobile
npx expo start          # press i for iOS simulator, a for Android emulator, or scan with Expo Go
```

Point the app at your machine with `EXPO_PUBLIC_API_URL` (defaults: `10.0.2.2:8000` on the Android emulator,
`127.0.0.1:8000` on iOS):

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 npx expo start
```

The mobile client uses the platform speech recognizer for partials and `expo-speech` for output, and shares the exact
same translation/language/memory logic as the web app through `@quanstate/services`.

## Latency: what the numbers actually mean

The product contract is **p95 ≤ 100 ms end-to-end** with a **≤ 5 ms hot path**. Those are different workloads:

| Stage | Measured | Where |
|---|---|---|
| Audio ingest + VAD per 20 ms frame | **p95 0.011 ms** | `tests/test_pipeline.py::test_audio_ingest_hot_path_stays_under_five_milliseconds` |
| Cached translation | **p95 < 5 ms** (live run: p95 0.01 ms) | `tests/test_translation.py`, `tests/test_live_latency.py` |
| WebSocket round trip (localhost, text) | **p95 0.29 ms** | `tests/test_live_latency.py` (real Uvicorn + websockets) |
| TTS first audio frame | **8.5 ms** | real pipeline run below |
| Browser PCM conversion (48 k → 16 k, PCM16) | **p95 < 5 ms** | `services/test/pcm.test.ts` |
| Whisper tiny int8, 4 s utterance | **≈ 420 ms** | measured on 4 vCPU |
| Whisper tiny int8, 11 s utterance | **≈ 370–430 ms warm** | measured on 4 vCPU |

Neural inference cannot run in 5 ms on a CPU. So the design keeps *everything except model inference* inside the 5 ms
hot path, and makes the model path feel instant:

- translation memory + versioned LRU answer repeats and known phrases in microseconds;
- partial transcripts stream while the person is still talking, so the wait after they stop is only finalisation;
- TTS starts streaming as soon as the translation lands (first frame 8.5 ms measured);
- server inference runs off the event loop (`asyncio.to_thread`) so audio ingest, pings and other sessions never stall;
- budgets are asserted by tests and exposed at `/v1/metrics` and in the client HUD.

Measured real pipeline (real Whisper, 4 s JFK excerpt, CPU): `STT 424 ms · translation 0.28 ms · TTS first frame 8.5 ms`.
With `faster-whisper` `tiny` on 4 vCPU that is the expected CPU result; use `base`/`small` on GPU or the HTTP provider
for production accuracy.

## Teaching the device

Upload a glossary (`source = target`, `source | target`, tab-separated) or a whole document from the **Teach** screen.
The service:

1. extracts explicit bilingual pairs and mirrors them (`en→es` and `es→en`),
2. ranks domain terms (capitalisation, camelCase, digits, repetition) into a protected glossary,
3. pushes source and target terms into STT hotwords,
4. bumps the memory version, invalidating stale cached translations on the next utterance.

YouTube ingestion reads the public caption track and, when available, YouTube's machine-translated track as a parallel
corpus. YouTube aggressively rate-limits anonymous caption downloads (`429`); the learner degrades to monolingual term
mining and reports it, and an exported `.srt`/`.vtt` can always be uploaded instead. No API key is required.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `QUANSTATE_DATA_DIR` | `api/data/runtime` | profiles, learned memory, uploads metadata |
| `QUANSTATE_STT` | `none` | `none`, `auto`, `faster-whisper`, `http`, `scripted` |
| `QUANSTATE_WHISPER_MODEL` | `tiny` | model size, name, or a local CTranslate2 directory |
| `QUANSTATE_STT_HTTP_URL` | — | OpenAI-compatible transcription endpoint |
| `QUANSTATE_TRANSLATOR` | `auto` | `auto`, `memory`, `nllb`, `http` |
| `QUANSTATE_TRANSLATE_HTTP_URL` | — | LibreTranslate-compatible endpoint |
| `QUANSTATE_TTS` | `auto` | `auto` (formant), `piper`, `tone` |
| `QUANSTATE_PIPER_VOICES` | — | directory with Piper `.onnx` voices |
| `QUANSTATE_FAST_PATH_MS` / `QUANSTATE_E2E_MS` | `5` / `100` | latency budget |
| `QUANSTATE_CA_BUNDLE` | — | extra CA for TLS-inspecting proxies |
| `QUANSTATE_CORS_ORIGINS` | `*` | comma-separated allowed origins |

Optional extras: `pip install -e "api[stt]"` (faster-whisper), `api[nllb]` (NLLB-200), `api[pdf]` (PDF ingestion).
Piper needs the `piper` binary and voices; set `QUANSTATE_TTS=piper`.

## Tests and benchmarks

```bash
# Python: unit + REST + WebSocket + real Uvicorn latency benchmark
cd api && pytest -q                      # 73 tests (1 optional model test skips)
pytest tests/test_live_latency.py -q -s  # prints the live latency report

# Shared SDK (protocol, transport/reconnect, PCM, metrics, session state machine)
npm run test --workspace @quanstate/services   # 30 tests

# Cross-language E2E: the real SDK against the real service (start the API first)
npm run build --workspace @quanstate/services
node scripts/e2e-client.mjs http://127.0.0.1:8000

# Type checks + production build
npm run typecheck
npm run build
npm run smoke:web        # boots the built bundle in jsdom and asserts the language screen
```

Run the real-model STT check on any machine with a local Whisper directory:

```bash
cd api
QUANSTATE_WHISPER_MODEL=/models/faster-whisper-tiny \\
QUANSTATE_TEST_AUDIO=/path/to/16k.wav \\
pytest tests/test_local_stt_optional.py -q -s
```

## Deployment

```bash
docker compose up --build     # API + built web app on http://localhost:8000
```

For production: terminate TLS at the edge, set `QUANSTATE_CORS_ORIGINS` to your origins, add authentication (the API
currently trusts the profile name), put a reverse proxy in front for WebSocket upgrades, and run one Uvicorn worker per
CPU with sticky sessions (sessions hold in-memory cache and VAD state). Syncing learned memory across replicas is a
matter of mounting `QUANSTATE_DATA_DIR` on shared storage and rebuilding snapshots on version change.

## Known limitations / next steps

- The bundled offline translator is a phrasebook + lexicon, not a general MT model. For open-domain translation set
  `QUANSTATE_TRANSLATOR=nllb` or point it at LibreTranslate; the memory layer stays in front as a fast, glossary-aware
  cache.
- YouTube caption endpoints are rate-limited without cookies; upload an SRT/VTT or retry later.
- Mobile uses native recognition today. Raw PCM streaming from iOS/Android is supported by the SDK (`MicrophoneStream`)
  and needs a small native capture adapter (`react-native-audio-api` or a custom AVAudioEngine/AudioRecord bridge).
- No authentication/authorisation yet; profiles are logical namespaces, not users.
- Verified here with Python 3.11, Node 24, Chromium-class Web Audio, and a successful `expo export --platform android`
  bundle; no physical iOS/Android device was available, so native capture was not exercised on hardware.
