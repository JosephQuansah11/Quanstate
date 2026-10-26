# Architecture

Quanstate is a single realtime service with three thin clients. The service owns language logic, speech models,
translation memory and learning; clients own capture, playback and the platform voice. The same TypeScript package
(`@quanstate/services`) drives web (React + AudioWorklet) and mobile (Expo + native speech), so protocol, reconnect,
latency accounting and learning APIs cannot drift between platforms.

## 1. Responsibilities

| Layer | Owns | Does **not** own |
|---|---|---|
| `api/` (Python) | VAD, STT, translation, TTS synthesis, memory, learning, metrics, profiles | UI, microphone permissions, device voices |
| `services/` (TypeScript) | protocol codec, WebSocket transport, PCM conversion/framing, session state machine, speech queue, REST client | rendering, navigation, native audio modules |
| `apps/web` | AudioWorklet capture, browser STT, `speechSynthesis`, PCM playback, UI | translation rules, learning |
| `apps/mobile` | native recognizer + `expo-speech`, document picker, UI | translation rules, learning |

## 2. Realtime data path

```
mic ──► AudioCapture ──► PcmFrameChunker (Float32 → 16 kHz → PCM16, 20 ms)
                                   │
                                   ▼  binary frames over WebSocket
                              ┌───────────────┐
                              │  DuplexPipeline│
                              │  resample      │
                              │  VAD (20 ms)   │──► partial hypothesis scheduler
                              │  bounded queue │
                              └───────┬────────┘
                                      ▼ single worker
                          STT ──► translate (cache → memory → model) ──► event
                                                                  └──► TTS stream (if server voice)
```

**Ingest is never blocked by inference.** `feed_audio` only resamples, frames, runs the VAD and enqueues an utterance;
one worker coroutine owns STT/translation/TTS. A full queue drops the *oldest* job (stale audio is worse than a gap)
and increments `droppedJobs`. Partial hypotheses are scheduled every 450 ms *of speech* (not wall clock), so bursty
network delivery behaves the same as real-time capture.

**Endpointing.** `StreamingVad` is an adaptive energy detector: noise floor EMA, minimum energy floor, 120 ms minimum
speech, 280 ms hangover, 200 ms pre-roll and a 20 s max utterance. Pre-roll means the first phoneme is not lost.

**Backpressure & lifecycle.** One WebSocket per session; `session.start` binds languages/profile/TTS mode. A
`session.stop` flushes stats then closes. Client transport reconnects with exponential backoff and re-sends
`session.start`, and drops audio frames rather than queueing stale PCM while offline.

## 3. Engines

All engines sit behind small protocols (`Translator`, `Transcriber`, `Synthesizer`) so providers can be swapped without
touching pipelines or clients.

### Translation

1. **Versioned LRU cache** — key = `(memory_version, source, target, text)`. Cache hits return in microseconds; any
   upload bumps `memory_version`, so stale translations cannot survive learning.
2. **Glossary protection** — longest-match glossary term wins inside a sentence, preserving terminology casing.
3. **Phrase memory** — seeded travel/technical phrasebook in both directions plus learned pairs, longest phrase first
   (up to 6 tokens). CJK text uses character n-gram longest match instead of whitespace tokens.
4. **Word lexicon + morphology** — en↔es/fr/de fallback, simple plural/gerund stemming, unknown words preserved and
   lower confidence. This is the offline floor, not a general MT model.
5. **Optional providers** — `ChainTranslator` starts with memory and only calls NLLB-200 or LibreTranslate when
   coverage is below 85% and no glossary hit exists. HTTP/model work runs off the event loop.

Confidence and coverage are surfaced on every event so the UI can warn about low-coverage translations.

### Speech recognition

- `FasterWhisperTranscriber` (int8, CPU) with `beam_size=1`, no internal VAD (the pipeline already segments), initial
  prompt built from learned hotwords, thread-offloaded and serialised per model. Rolling last 8 s for partials.
- `HttpWhisperTranscriber` posts WAV utterances to any OpenAI-compatible endpoint with hotword prompt.
- `ScriptedTranscriber` is a deterministic test double used by CI/latency benchmarks.
- `NullTranscriber` leaves recognition to the client while still consuming audio for VAD/telemetry/learning.

### Voice output

- Clients speak locally by default (`ttsMode=client`): zero extra network hop and the platform's best voice.
- `ToneSynthesizer` is a dependency-free formant synthesizer (per-syllable vowel formants, consonant noise, pitch by
  language) used for tests, offline demos and `/v1/tts` WAV export.
- `PiperSynthesizer` streams raw PCM from the `piper` binary. Server TTS is chunked into 20 ms binary frames with
  `tts.start`/`tts.end`; the client can start playback on the first chunk.

## 4. Learning

Learning is **memory-based, not model retraining**, so it applies to the very next sentence and is reversible per
profile.

```
upload ──► text extraction ──► pair extraction (a = b, a | b, TSV)
   │                │                 │
   │                └─► term ranking ──┼─► protected glossary
   │                                  └─► STT hotwords
   └─► document record (provenance, counts, digest) ──► atomic JSON write ──► version++ ──► cache key changes
```

- **Documents**: `.txt`, `.md`, `.srt`, `.vtt`, `.csv`, `.tsv`, `.json`, `.html`, `.docx` (zip/XML, no heavy dep) and
  `.pdf` with the optional `pypdf` extra. 20 MB limit; SRT/VTT cues are stripped to spoken lines.
- **YouTube**: watch page → `captionTracks` → JSON3 timedtext, with `tlang` for a translated track. The source track is
  fetched first so a rate-limited translation still yields terminology. Bilingual pairs become weighted phrases
  (weight 1.4) in both directions; all cues feed term ranking. Rate limits are reported to the client.
- **Storage**: one JSON document per profile, atomic `tmp → os.replace`, in-memory immutable `MemorySnapshot` with a
  monotonic version. Reads never lock on the audio path; writes hold an `RLock`.
- **Improvement loop**: phrase pairs change translation immediately; glossary changes protect terminology; hotwords
  change the next STT request's `initial_prompt`; document records power the Teach screen.

## 5. Shared TypeScript SDK

| Module | Responsibility |
|---|---|
| `protocol.ts` | discriminated unions and runtime validation for every wire message |
| `transport.ts` | injectable WebSocket factory, bounded control queue, reconnect/backoff, RTT, audio drop policy |
| `pcm.ts` | box/linear resampling, PCM16 conversion, 20 ms chunker, bounded playback buffer |
| `realtime.ts` | session lifecycle, event fan-out, latency/budget tracking, re-session after reconnect |
| `audio.ts` | `MicrophoneStream`, `SpeechQueue`, `ServerVoicePlayer`, platform interfaces |
| `learning.ts` | typed REST client for documents, YouTube, memory, TTS |
| `device.ts` | façade used by both apps |

Platform-specific pieces are injected: `AudioCapture` (AudioWorklet / native bridge), `SpeechSink`
(`speechSynthesis` / `expo-speech`), `PcmAudioSink` (Web Audio / native player) and a WebSocket factory.

## 6. Clients

**Web.** AudioWorklet capture with ScriptProcessor fallback, 20 ms PCM16 framing, Web Speech for on-device partials
(when server STT is absent), `speechSynthesis` voice matching by BCP-47, and scheduled AudioBuffer playback for server
TTS. State is persisted in `localStorage` (language pair, voice mode, auto-speak).

**Mobile.** Expo SDK 58 + React Native 0.88. Native recognizer (`expo-speech-recognition`) yields partials/finals; the
final text enters the same `RealtimeSession` and translation memory. `expo-speech` speaks locally; documents go through
`expo-document-picker` → `File`/Blob → the same REST learning endpoints. The SDK already exposes
`MicrophoneStream`/`PcmFrameChunker`, so adding raw PCM streaming on mobile only needs a native capture adapter
(`react-native-audio-api` or AVAudioEngine/AudioRecord) that calls `onSamples(Float32Array, sampleRate)`.

## 7. Latency engineering & evidence

Targets: **p95 end-to-end ≤ 100 ms**, **hot path ≤ 5 ms**.

| Technique | Effect |
|---|---|
| Binary PCM frames, no base64/JSON audio | removes ~33% payload overhead and parse cost |
| Preallocated typed arrays, numpy views | 20 ms frame ingest p95 ≈ **0.011 ms** |
| Cache keyed by memory version | repeats ≈ **0.01–0.3 ms** server translation |
| Partial hypotheses + endpoint detection | perceived wait starts before speech ends |
| Single worker + bounded queue | inference never blocks ingest; memory stays flat |
| Off-loop model calls | pings/other sessions unaffected by 400 ms inference |
| Streamed TTS frames | first audio 8.5 ms after translation |

CI asserts these budgets: cached translation p95 < 5 ms, audio ingest p95 < 5 ms, live WebSocket round trip p95
< 100 ms, translation p95 < 5 ms, server-reported budget `ok`, and browser PCM conversion p95 < 5 ms. Real Whisper
numbers are documented rather than hidden: CPU int8 tiny takes ~370–430 ms for 4–11 s utterances; streaming partials and
shorter VAD segments bound the wait.

## 8. Reliability, security, operations

- Uploads validated by extension and size; profile names restricted to `[a-zA-Z0-9_-]{1,64}`; no path traversal.
- Protocol validates languages, sample rate, text length, hotwords, TTS mode; errors are typed and recoverable.
- Unknown messages never kill a session; engine failures emit `error` events and keep the socket open.
- Atomic writes; per-profile isolation; `DELETE /v1/memory/{profile}` for user erasure.
- TLS: optional extra CA bundle (`QUANSTATE_CA_BUNDLE`, `SSL_CERT_FILE`) for proxies; checks are never disabled.
- **Gaps before public production**: authn/authz (profile names are not identities), rate limiting, request signing for
  uploads, persistent job queue for long ingestions, and a shared cache across replicas.
- Scaling: one Uvicorn worker per CPU, sticky sessions for WebSocket, shared `QUANSTATE_DATA_DIR`, model instances per
  worker. CPU Whisper is the bottleneck — move STT to an HTTP provider or GPU for scale.

## 9. Testing strategy

- Unit: audio/PCM/VAD, protocol validation, translation memory and cache invalidation, learning extraction, storage
  persistence/isolation, engine composition, TTS WAV container.
- In-process integration: pipeline audio → transcript → translation → streamed TTS; text path; language switching;
  partials; hotword propagation; budget snapshots; FastAPI REST + WebSocket via `TestClient`.
- Live integration: real Uvicorn subprocess + `websockets` client, 60 text turns + binary audio, measured p50/p95/max and
  cache hit rate (printed as `LIVE LATENCY REPORT`).
- Optional real-model test: local CTranslate2 Whisper + WAV, skipped unless env vars are provided.
- Web runtime smoke: `scripts/web-smoke.mjs` and `scripts/web-live-smoke.mjs` boot the production bundle in jsdom with
  mocked fetch/WebSocket, asserting the language screen, session handshake, typed translation and cache badge.
- Cross-language E2E: `scripts/e2e-client.mjs` uses the production SDK build against a running service (WebSocket
  translation, learning, memory and WAV TTS), proving the Python and TypeScript halves speak the same protocol.
- TypeScript: protocol round-trips, transport queue/reconnect, session event routing, PCM conversion benchmarks, metrics,
  language-catalogue parity with the Python JSON source of truth.
