"""Duplex realtime pipeline: audio in -> speech -> translation -> speech out.

Latency design:
* Audio ingest never awaits a model.  Frames are resampled, VAD'd and queued; a
  single worker owns inference, so the receive loop stays sub-millisecond.
* Translation is cache-first (versioned LRU).  A repeat utterance is answered in
  well under 5 ms; first-time utterances pay one memory lookup (~50-200 us).
* Optional neural engines run off the event loop (``asyncio.to_thread``) so they
  cannot stall websocket heartbeats.
* TTS is streamed frame by frame; clients speak the first chunk immediately.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import numpy as np

from .audio import StreamingVad, float32_to_pcm16le, pcm16le_to_float32, resample
from .config import Settings
from .engines.base import EngineError, TranslationHints
from .engines.registry import EngineSet, capabilities
from .learning.store import MemoryStore
from .languages import require_pair
from .metrics import LatencyRecorder
from .protocol import (
    PROTOCOL_VERSION,
    SERVER_SESSION_READY,
    SERVER_STATS,
    SERVER_STT_FINAL,
    SERVER_STT_PARTIAL,
    SERVER_TRANSLATION,
    SERVER_TTS_END,
    SERVER_TTS_START,
    SessionConfig,
    error,
    new_id,
)

LOGGER = logging.getLogger("quanstate.pipeline")

SendFn = Callable[[dict[str, Any]], Awaitable[None]]
AudioFn = Callable[[bytes], Awaitable[None]]

PARTIAL_INTERVAL_S = 0.45
MIN_PARTIAL_AUDIO_S = 0.4


@dataclass
class _Job:
    kind: str
    received_at: float
    samples: np.ndarray | None = None
    text: str = ""
    segment_id: str = ""
    start_ms: float = 0.0
    end_ms: float = 0.0
    source: str = "stt"
    confidence: float = 1.0


@dataclass
class _Counters:
    frames: int = 0
    dropped_jobs: int = 0
    utterances: int = 0
    translations: int = 0
    partials: int = 0
    tts_chunks: int = 0
    errors: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "frames": self.frames,
            "droppedJobs": self.dropped_jobs,
            "utterances": self.utterances,
            "translations": self.translations,
            "partials": self.partials,
            "ttsChunks": self.tts_chunks,
            "errors": self.errors,
        }



class DuplexPipeline:
    def __init__(
        self,
        config: SessionConfig,
        engines: EngineSet,
        store: MemoryStore,
        send: SendFn,
        send_audio: AudioFn,
        settings: Settings,
        metrics: LatencyRecorder | None = None,
    ) -> None:
        self.config = config
        self.engines = engines
        self.store = store
        self._send = send
        self._send_audio = send_audio
        self.settings = settings
        self.sample_rate = settings.sample_rate
        self.metrics = metrics or LatencyRecorder()
        self.counters = _Counters()

        source, target = require_pair(config.source, config.target)
        self.source_lang = source.code
        self.target_lang = target.code
        self.tts_mode = config.tts_mode

        self._vad = StreamingVad(
            sample_rate=self.sample_rate,
            frame_ms=settings.frame_ms,
            end_silence_ms=280.0,
        )
        self._frame_samples = int(self.sample_rate * settings.frame_ms / 1000)
        self._residual = np.zeros(0, dtype=np.float32)
        self._queue: asyncio.Queue[_Job] = asyncio.Queue(maxsize=settings.audio_queue_size)
        self._worker: asyncio.Task[None] | None = None
        self._closed = False
        self._generation = 0
        self._active_id = ""
        self._was_speaking = False
        self._last_partial_at = 0.0
        self._partial_busy = False
        self._partial_task: asyncio.Task[None] | None = None
        self._hotwords_cached: tuple[int, tuple[str, ...]] = (-1, ())

    # --------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        self._worker = asyncio.create_task(self._run_worker())
        snapshot = self.store.snapshot(self.config.profile)
        await self._send(
            {
                "type": SERVER_SESSION_READY,
                "protocolVersion": PROTOCOL_VERSION,
                "sessionId": self.config.session_id,
                "sourceLang": self.source_lang,
                "targetLang": self.target_lang,
                "sampleRate": self.sample_rate,
                "ttsMode": self.tts_mode,
                "profile": self.config.profile,
                "engines": {
                    "translation": self.engines.translation_provider,
                    "speechToText": self.engines.stt_provider,
                    "textToSpeech": self.engines.tts_provider,
                },
                "capabilities": capabilities(self.settings, self.engines),
                "memory": dict(snapshot.stats) | {"version": snapshot.version},
                "budget": {
                    "fastPathMs": self.settings.latency_budget.fast_path_ms,
                    "endToEndMs": self.settings.latency_budget.end_to_end_ms,
                    "frameMs": self.settings.frame_ms,
                },
                "hotwords": list(self._hotwords()),
            }
        )

    async def close(self) -> None:
        self._closed = True
        if self._partial_task is not None:
            self._partial_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._partial_task
        with contextlib.suppress(asyncio.QueueFull):
            self._queue.put_nowait(_Job(kind="stop", received_at=time.perf_counter()))
        if self._worker is not None:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await asyncio.wait_for(self._worker, timeout=5.0)

    async def stats(self) -> dict[str, Any]:
        return {
            "type": SERVER_STATS,
            "sessionId": self.config.session_id,
            "latency": self.metrics.snapshot(self.settings.latency_budget),
            "counters": self.counters.as_dict(),
            "queueDepth": self._queue.qsize(),
            "streaming": self.engines.transcriber.supports_partials,
        }

    async def send_stats(self) -> None:
        await self._send(await self.stats())


    # ------------------------------------------------------------------ ingest
    async def feed_audio(self, data: bytes) -> None:
        if self._closed or not data:
            return
        started = time.perf_counter()
        if len(data) % 2:
            data = data[:-1]
        samples = pcm16le_to_float32(data)
        if self.config.sample_rate != self.sample_rate:
            samples = resample(samples, self.config.sample_rate, self.sample_rate)
        if self._residual.size:
            samples = np.concatenate((self._residual, samples))

        usable = (samples.size // self._frame_samples) * self._frame_samples
        self._residual = samples[usable:]
        self.counters.frames += usable // self._frame_samples

        for start in range(0, usable, self._frame_samples):
            frame = samples[start : start + self._frame_samples]
            utterances = self._vad.push(frame)
            speaking = self._vad.speaking
            if speaking and not self._was_speaking:
                self._active_id = new_id("utt")
                self._last_partial_at = time.perf_counter()
            self._was_speaking = speaking
            for utterance in utterances:
                self._generation += 1
                self._enqueue(
                    _Job(
                        kind="audio",
                        received_at=time.perf_counter(),
                        samples=utterance.samples,
                        segment_id=self._active_id or new_id("utt"),
                        start_ms=utterance.start_ms,
                        end_ms=utterance.end_ms,
                    )
                )
            if speaking:
                self._maybe_partial()
        self.metrics.record("audio_ingest", (time.perf_counter() - started) * 1000.0)

    async def flush_audio(self) -> None:
        utterance = self._vad.flush()
        if utterance is not None:
            self._generation += 1
            self._enqueue(
                _Job(
                    kind="audio",
                    received_at=time.perf_counter(),
                    samples=utterance.samples,
                    segment_id=self._active_id or new_id("utt"),
                    start_ms=utterance.start_ms,
                    end_ms=utterance.end_ms,
                )
            )

    async def feed_text(self, text: str, segment_id: str | None = None, source: str = "client") -> None:
        if self._closed or not text.strip():
            return
        self._enqueue(
            _Job(
                kind="text",
                received_at=time.perf_counter(),
                text=text.strip()[:8000],
                segment_id=segment_id or new_id("utt"),
                source=source,
                confidence=1.0,
            )
        )

    async def update_config(self, message: dict[str, Any]) -> dict[str, Any]:
        target = message.get("targetLang")
        source = message.get("sourceLang")
        if source or target:
            new_source, new_target = require_pair(source or self.source_lang, target or self.target_lang)
            if new_source.code != self.source_lang or new_target.code != self.target_lang:
                self.source_lang, self.target_lang = new_source.code, new_target.code
                self._vad = StreamingVad(
                    sample_rate=self.sample_rate,
                    frame_ms=self.settings.frame_ms,
                    end_silence_ms=280.0,
                )
                self._residual = np.zeros(0, dtype=np.float32)
                self._was_speaking = False

        tts_mode = message.get("ttsMode")
        if tts_mode:
            if tts_mode not in {"client", "server"}:
                raise ValueError("ttsMode must be 'client' or 'server'")
            self.tts_mode = tts_mode

        hotwords = message.get("hotwords")
        if isinstance(hotwords, list):
            self.config = SessionConfig(
                session_id=self.config.session_id,
                source=self.source_lang,
                target=self.target_lang,
                sample_rate=self.config.sample_rate,
                tts_mode=self.tts_mode,
                profile=self.config.profile,
                on_device_stt=self.config.on_device_stt,
                locale_hint=self.config.locale_hint,
                hotwords=tuple(word for word in hotwords if isinstance(word, str))[:256],
            )
            self._hotwords_cached = (-1, ())

        updated = {
            "type": "config.updated",
            "sourceLang": self.source_lang,
            "targetLang": self.target_lang,
            "ttsMode": self.tts_mode,
            "hotwords": list(self._hotwords()),
        }
        await self._send(updated)
        return updated

    async def drain(self) -> None:
        """Wait until every queued utterance has been answered (tests/benchmarks)."""

        await self._queue.join()

    # ------------------------------------------------------------------ worker
    def _enqueue(self, job: _Job) -> None:
        if self._closed:
            return
        try:
            self._queue.put_nowait(job)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                self._queue.get_nowait()
                self._queue.task_done()
            self.counters.dropped_jobs += 1
            try:
                self._queue.put_nowait(job)
            except asyncio.QueueFull:
                self.counters.dropped_jobs += 1

    async def _run_worker(self) -> None:
        while True:
            job = await self._queue.get()
            try:
                if job.kind == "stop":
                    return
                if job.kind == "audio":
                    await self._process_audio(job)
                elif job.kind == "text":
                    await self._process_text(job)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # keep the session alive on engine bugs
                LOGGER.exception("pipeline job failed")
                self.counters.errors += 1
                await self._fail("pipeline_error", str(exc))
            finally:
                self._queue.task_done()

    async def _process_audio(self, job: _Job) -> None:
        if job.samples is None or job.samples.size == 0:
            return
        self.counters.utterances += 1
        started = time.perf_counter()
        try:
            transcript = await self.engines.transcriber.transcribe(
                job.samples,
                self.sample_rate,
                self.source_lang,
                self._hotwords(),
            )
        except EngineError as exc:
            await self._fail("stt_failed", str(exc))
            return
        stt_ms = (time.perf_counter() - started) * 1000.0
        self.metrics.record("stt", stt_ms)

        text = transcript.text.strip()
        if not text:
            self.metrics.increment("stt_empty")
            return

        await self._safe_send(
            {
                "type": SERVER_STT_FINAL,
                "id": job.segment_id,
                "text": text,
                "language": self.source_lang,
                "confidence": round(transcript.confidence, 3),
                "startMs": round(job.start_ms, 1),
                "endMs": round(job.end_ms, 1),
                "latencyMs": round(stt_ms, 2),
                "engine": transcript.detail.get("engine", self.engines.stt_provider),
            }
        )
        await self._translate_and_emit(job.segment_id, text, stt_ms, job.received_at)

    async def _process_text(self, job: _Job) -> None:
        await self._safe_send(
            {
                "type": SERVER_STT_FINAL,
                "id": job.segment_id,
                "text": job.text,
                "language": self.source_lang,
                "confidence": job.confidence,
                "startMs": 0,
                "endMs": 0,
                "latencyMs": 0.0,
                "engine": job.source,
            }
        )
        await self._translate_and_emit(job.segment_id, job.text, 0.0, job.received_at)

        """Wait until every queued utterance has been answered (tests/benchmarks)."""

        await self._queue.join()


    async def _translate_and_emit(
        self, segment_id: str, text: str, stt_ms: float, received_at: float
    ) -> None:
        snapshot = self.store.snapshot(self.config.profile)
        hints = TranslationHints(
            profile=self.config.profile,
            memory_version=snapshot.version,
            hotwords=self._hotwords(),
        )
        started = time.perf_counter()
        try:
            result = await self.engines.translator.translate(text, self.source_lang, self.target_lang, hints)
        except EngineError as exc:
            await self._fail("translation_failed", str(exc))
            return
        translation_ms = (time.perf_counter() - started) * 1000.0
        end_to_end_ms = (time.perf_counter() - received_at) * 1000.0
        self.metrics.record("translation", translation_ms)
        self.metrics.record("e2e", end_to_end_ms)
        if result.cached:
            self.metrics.record("fast_path", translation_ms)
        self.counters.translations += 1

        await self._safe_send(
            {
                "type": SERVER_TRANSLATION,
                "id": segment_id,
                "sourceText": text,
                "text": result.text,
                "sourceLang": self.source_lang,
                "targetLang": self.target_lang,
                "engine": result.engine,
                "cached": result.cached,
                "confidence": result.confidence,
                "coverage": result.coverage,
                "glossaryHits": list(result.glossary_hits),
                "latency": {
                    "sttMs": round(stt_ms, 2),
                    "translationMs": round(translation_ms, 2),
                    "endToEndMs": round(end_to_end_ms, 2),
                    "budgetMs": self.settings.latency_budget.end_to_end_ms,
                },
            }
        )

        if self.tts_mode == "server" and result.text.strip():
            await self._stream_tts(segment_id, result.text)

    async def _stream_tts(self, segment_id: str, text: str) -> None:
        synthesize = self.engines.synthesizer
        tts_id = new_id("tts")
        started = time.perf_counter()
        first_byte_ms: float | None = None
        chunks = 0
        samples_total = 0
        voice_rate = int(getattr(synthesize, "sample_rate", self.sample_rate))
        await self._safe_send(
            {
                "type": SERVER_TTS_START,
                "id": tts_id,
                "segmentId": segment_id,
                "voice": synthesize.name,
                "format": "pcm16",
                "sampleRate": self.sample_rate,
                "text": text,
            }
        )
        try:
            async for frame in synthesize.stream(text, self.target_lang):
                if frame.size == 0:
                    continue
                if voice_rate != self.sample_rate:
                    frame = resample(frame, voice_rate, self.sample_rate)
                for start in range(0, frame.size, self._frame_samples):
                    chunk = frame[start : start + self._frame_samples]
                    if chunk.size == 0:
                        continue
                    await self._send_audio(float32_to_pcm16le(chunk))
                    chunks += 1
                    self.counters.tts_chunks += 1
                samples_total += frame.size
                if first_byte_ms is None:
                    first_byte_ms = (time.perf_counter() - started) * 1000.0
                    self.metrics.record("tts_first_byte", first_byte_ms)
        except EngineError as exc:
            await self._fail("tts_failed", str(exc))
            return
        await self._safe_send(
            {
                "type": SERVER_TTS_END,
                "id": tts_id,
                "segmentId": segment_id,
                "chunks": chunks,
                "firstByteMs": round(first_byte_ms or 0.0, 2),
                "durationMs": round(samples_total / self.sample_rate * 1000.0, 1),
                "voice": synthesize.name,
            }
        )


    # ---------------------------------------------------------------- partials
    def _maybe_partial(self) -> None:
        if not self.engines.transcriber.supports_partials or self._partial_busy:
            return
        now = time.perf_counter()
        if now - self._last_partial_at < PARTIAL_INTERVAL_S:
            return
        if self._vad.current_audio().size < MIN_PARTIAL_AUDIO_S * self.sample_rate:
            return
        self._last_partial_at = now
        self._partial_task = asyncio.create_task(self._run_partial(self._generation, self._active_id))

    async def _run_partial(self, generation: int, segment_id: str) -> None:
        self._partial_busy = True
        started = time.perf_counter()
        try:
            samples = self._vad.current_audio()
            if samples.size < MIN_PARTIAL_AUDIO_S * self.sample_rate:
                return
            transcript = await self.engines.transcriber.transcribe(
                samples,
                self.sample_rate,
                self.source_lang,
                self._hotwords(),
                partial=True,
            )
            elapsed = (time.perf_counter() - started) * 1000.0
            self.metrics.record("stt_partial", elapsed)
            if generation != self._generation or not transcript.text.strip():
                return
            self.counters.partials += 1
            await self._safe_send(
                {
                    "type": SERVER_STT_PARTIAL,
                    "id": segment_id,
                    "text": transcript.text.strip(),
                    "language": self.source_lang,
                    "confidence": round(transcript.confidence, 3),
                    "latencyMs": round(elapsed, 2),
                    "engine": transcript.detail.get("engine", self.engines.stt_provider),
                }
            )
        except asyncio.CancelledError:
            raise
        except EngineError:
            return
        finally:
            self._partial_busy = False

    # ----------------------------------------------------------------- helpers
    def _hotwords(self) -> tuple[str, ...]:
        snapshot = self.store.snapshot(self.config.profile)
        if snapshot.version != self._hotwords_cached[0]:
            learned = snapshot.hotwords.get(self.source_lang, ())
            merged = tuple(dict.fromkeys((*self.config.hotwords, *learned)))[:200]
            self._hotwords_cached = (snapshot.version, merged)
        return self._hotwords_cached[1]

    async def _safe_send(self, message: dict[str, Any]) -> None:
        try:
            await self._send(message)
        except Exception:  # socket closed mid-flight
            LOGGER.debug("client send failed", exc_info=True)

    async def _fail(self, code: str, message: str) -> None:
        self.counters.errors += 1
        await self._safe_send(error(message, code=code))
