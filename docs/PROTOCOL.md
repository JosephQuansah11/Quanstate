# Realtime protocol (v1)

- Endpoint: `GET /v1/realtime` → WebSocket upgrade.
- Control frames: **JSON text**. Audio frames: **binary**, raw little-endian signed 16-bit PCM, mono, at the negotiated
  rate (default **16 000 Hz**), no header, no base64.
- Frame size for capture: 20 ms = 320 samples = **640 bytes**. The server tolerates any even-length chunk and reframes
  internally.
- All field names are camelCase; languages use the catalogue codes from `GET /v1/languages`.
- `PROTOCOL_VERSION = 1`.

## Client → server

| `type` | Fields | Notes |
|---|---|---|
| `session.start` | `sourceLang`, `targetLang`, `sampleRate?`, `ttsMode?`, `profile?`, `sessionId?`, `features?`, `hotwords?`, `localeHint?` | Must be first control frame. Sample rate 8–48 kHz. `ttsMode: "client"|"server"`, default `client`. |
| `text.input` | `text`, `id?` | Typed text or on-device STT result. 1–8 000 chars. Goes through the same translation/TTS path. |
| `audio.flush` | — | End of utterance; flushes VAD immediately instead of waiting for hangover. |
| `config.update` | `sourceLang?`, `targetLang?`, `ttsMode?`, `hotwords?` | Mid-session re-targeting; resets VAD when languages change. |
| `ping` | `t` | Echoed in `pong` for RTT. |
| `session.stop` | — | Server responds with `stats`, then `session.stopped`, then closes on its side. |
| binary | PCM16LE mono | Streamed while speaking. Ignored before `session.start` (error `no_session`). |

### Example

```json
{"type":"session.start","sourceLang":"en","targetLang":"es","sampleRate":16000,"ttsMode":"client","profile":"default","hotwords":["Quanstate"]}
```

## Server → client

| `type` | Fields | Notes |
|---|---|---|
| `session.ready` | `protocolVersion`, `sessionId`, `sourceLang`, `targetLang`, `sampleRate`, `ttsMode`, `profile`, `engines{translation,speechToText,textToSpeech}`, `capabilities`, `memory{version,phrases,learnedPhrases,glossary,documents,hotwords}`, `budget{fastPathMs,endToEndMs,frameMs}`, `hotwords[]` | Sent once after start. `memory.stats` are live counts. |
| `stt.partial` | `id`, `text`, `language`, `confidence`, `latencyMs`, `engine` | Only when the configured recognizer supports partials; same `id` as the eventual final. |
| `stt.final` | `id`, `text`, `language`, `confidence`, `startMs`, `endMs`, `latencyMs`, `engine` | `engine` is `"client"` for `text.input`. |
| `translation` | `id`, `sourceText`, `text`, `sourceLang`, `targetLang`, `engine`, `cached`, `confidence`, `coverage`, `glossaryHits[]`, `latency{sttMs,translationMs,endToEndMs,budgetMs}` | `endToEndMs` measured from end-of-utterance (or text arrival) to this event. |
| `tts.start` | `id`, `segmentId`, `voice`, `format:"pcm16"`, `sampleRate`, `text` | Followed by binary PCM16 frames. |
| `tts.end` | `id`, `segmentId`, `chunks`, `firstByteMs`, `durationMs`, `voice` | Client may start playback on the first chunk. |
| `stats` | `sessionId`, `latency{stages,budget,counters}`, `counters`, `queueDepth`, `streaming` | Percentiles and budget verdict. |
| `pong` | `t`, `serverTime` | RTT = receive time − `t`. |
| `config.updated` | `sourceLang`, `targetLang`, `ttsMode`, `hotwords[]` | Acknowledgement of `config.update`. |
| `session.stopped` | — | Terminal event. |
| `error` | `code`, `message`, `recoverable` | Session survives recoverable errors. |

### Example translation

```json
{
  "type": "translation",
  "id": "utt_9f2c1a4d7b31",
  "sourceText": "Where is the train station?",
  "text": "¿Dónde está la estación de tren?",
  "sourceLang": "en",
  "targetLang": "es",
  "engine": "memory+cache:cache",
  "cached": true,
  "confidence": 1.0,
  "coverage": 1.0,
  "glossaryHits": [],
  "latency": {"sttMs": 0, "translationMs": 0.04, "endToEndMs": 0.31, "budgetMs": 100}
}
```

## Sequence

```
client                                          server
  │ session.start ───────────────────────────────►│
  │◄──────────────────────────── session.ready     │
  │ [20 ms PCM16]×N ─────────────────────────────►│ VAD collects speech
  │◄────────────────────────────── stt.partial     │ (if supported)
  │ audio.flush / trailing silence ──────────────►│ endpoint
  │◄────────────────────────────── stt.final       │
  │◄────────────────────────────── translation     │
  │◄────────── tts.start + PCM frames + tts.end    │ (if ttsMode=server)
  │ ping ─────────────────────────────────────────►│
  │◄───────────────────────────────────── pong     │
  │ session.stop ─────────────────────────────────►│
  │◄──────────────────────────────────── stats     │
  │◄─────────────────────────── session.stopped    │
```

## Errors

| Code | Meaning | Recoverable |
|---|---|---|
| `bad_message` | invalid JSON / missing field / bad size | yes |
| `unsupported_language` | language not in catalogue or identical pair | yes |
| `no_session` | audio/text before `session.start` | yes |
| `config_error` | invalid `config.update` | yes |
| `frame_too_large` | binary frame > 1 MB | yes |
| `stt_failed` / `translation_failed` / `tts_failed` | engine/provider failure | yes |
| `internal` | unexpected server error | session may be reloaded |

## Reconnect & ordering

- The transport reconnects with jittered exponential backoff (8 attempts max by default). On reopen, the session
  re-sends `session.start` and the server creates a fresh pipeline (new VAD, same profile/memory).
- Control messages are queued while offline (bounded); audio is dropped and counted.
- Events for one utterance are ordered `stt.partial* → stt.final → translation → tts.start → binary* → tts.end`.
  Utterances are processed sequentially, so `translation` events preserve speech order.
- `id` is stable between partial/final/translation for UI reconciliation; `session.ready` starts a new ID namespace.

## REST control plane

| Method & path | Purpose |
|---|---|
| `GET /v1/health` | liveness, version, selected engines |
| `GET /v1/languages` | canonical catalogue (same data as the SDK) |
| `GET /v1/capabilities` | protocol version, engine/capability matrix |
| `POST /v1/translate` | synchronous text translation (debugging, tests, integrations) |
| `POST /v1/tts` | WAV audio for text (`audio/wav`) |
| `POST /v1/learn/documents` | multipart upload; fields `sourceLang`, `targetLang`, `profile`, `title` |
| `POST /v1/learn/text` | JSON `{text, filename, sourceLang, targetLang, profile, title}` |
| `POST /v1/learn/youtube` | JSON `{url, sourceLang, targetLang, profile, bilingual}` |
| `GET /v1/memory/{profile}` | stats, glossary, hotwords, documents |
| `DELETE /v1/memory/{profile}` | remove everything learned for a profile |
| `GET /v1/metrics` | service-wide latency percentiles + budget verdict |
| `POST /v1/metrics/reset` | reset rolling metrics |
