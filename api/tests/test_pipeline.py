from __future__ import annotations

import asyncio
import time
from typing import Any, Sequence

import numpy as np
import pytest

from quanstate.config import LatencyBudget, Settings
from quanstate.engines.base import Transcription
from quanstate.engines.registry import EngineSet
from quanstate.engines.synthesizer import ToneSynthesizer
from quanstate.engines.transcriber import ScriptedTranscriber
from quanstate.engines.translator import CachedTranslator, MemoryTranslator
from quanstate.learning.store import MemoryStore
from quanstate.languages import LanguageError
from quanstate.pipeline import DuplexPipeline
from quanstate.protocol import SessionConfig
from tests.conftest import pcm_bytes, silence, tone


class Recorder:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self.audio: list[bytes] = []

    async def send(self, message: dict[str, Any]) -> None:
        self.events.append(message)

    async def send_audio(self, data: bytes) -> None:
        self.audio.append(data)

    def of_type(self, kind: str) -> list[dict[str, Any]]:
        return [event for event in self.events if event.get("type") == kind]


def build(settings: Settings, store: MemoryStore, tts_mode: str = "client", cues: Sequence[str] | None = None):
    engines = EngineSet(
        translator=CachedTranslator(MemoryTranslator(store), settings.max_cache_entries),
        transcriber=ScriptedTranscriber(list(cues or ["where is the bathroom?", "thank you"])),
        synthesizer=ToneSynthesizer(),
        translation_provider="memory+cache",
        stt_provider="scripted",
        tts_provider="tone",
    )
    recorder = Recorder()
    config = SessionConfig(session_id="sess_test", source="en", target="es", tts_mode=tts_mode, profile="default")
    pipeline = DuplexPipeline(config, engines, store, recorder.send, recorder.send_audio, settings)
    return pipeline, recorder, engines


async def test_audio_to_translation_end_to_end(settings: Settings, store: MemoryStore) -> None:
    pipeline, recorder, _ = build(settings, store)
    await pipeline.start()
    ready = recorder.of_type("session.ready")[0]
    assert ready["sampleRate"] == 16_000
    assert ready["engines"]["translation"] == "memory+cache"

    speech = pcm_bytes(np.concatenate([tone(0.5), silence(0.5)]))
    for start in range(0, len(speech), 4096):
        await pipeline.feed_audio(speech[start : start + 4096])
    await asyncio.wait_for(pipeline.drain(), timeout=3)

    finals = recorder.of_type("stt.final")
    translations = recorder.of_type("translation")
    assert finals and finals[0]["text"] == "where is the bathroom?"
    assert translations and translations[0]["text"] == "¿dónde está el baño?"
    assert translations[0]["latency"]["endToEndMs"] < settings.latency_budget.end_to_end_ms
    assert pipeline.counters.frames > 0
    assert pipeline.counters.utterances == 1

    stats = await pipeline.stats()
    assert stats["counters"]["translations"] == 1
    assert "e2e" in stats["latency"]["stages"]
    await pipeline.close()


async def test_text_input_is_answered_and_cached(settings: Settings, store: MemoryStore) -> None:
    pipeline, recorder, _ = build(settings, store)
    await pipeline.start()
    await pipeline.feed_text("hello")
    await asyncio.wait_for(pipeline.drain(), timeout=2)
    await pipeline.feed_text("hello")
    await asyncio.wait_for(pipeline.drain(), timeout=2)

    translations = recorder.of_type("translation")
    assert [event["text"] for event in translations] == ["hola", "hola"]
    assert translations[0]["cached"] is False
    assert translations[1]["cached"] is True
    assert translations[1]["latency"]["translationMs"] < LatencyBudget().fast_path_ms
    assert recorder.of_type("stt.final")[0]["engine"] == "client"
    await pipeline.close()


async def test_server_tts_streams_pcm_frames(settings: Settings, store: MemoryStore) -> None:
    pipeline, recorder, _ = build(settings, store, tts_mode="server")
    await pipeline.start()
    await pipeline.feed_text("hello")
    await asyncio.wait_for(pipeline.drain(), timeout=3)

    starts = recorder.of_type("tts.start")
    ends = recorder.of_type("tts.end")
    assert starts and ends
    assert starts[0]["format"] == "pcm16"
    assert starts[0]["sampleRate"] == 16_000
    assert len(recorder.audio) > 3
    assert ends[0]["chunks"] == len(recorder.audio)
    assert ends[0]["firstByteMs"] < settings.latency_budget.tts_first_byte_ms
    assert ends[0]["durationMs"] > 50
    await pipeline.close()


async def test_language_change_retargets_translation(settings: Settings, store: MemoryStore) -> None:
    pipeline, recorder, _ = build(settings, store)
    await pipeline.start()
    updated = await pipeline.update_config({"targetLang": "fr"})
    assert updated["targetLang"] == "fr"
    await pipeline.feed_text("hello")
    await asyncio.wait_for(pipeline.drain(), timeout=2)
    assert recorder.of_type("translation")[0]["text"] == "bonjour"
    assert recorder.of_type("translation")[0]["targetLang"] == "fr"
    await pipeline.close()


async def test_learning_hotwords_flow_into_transcriber(settings: Settings, store: MemoryStore) -> None:
    store.add_hotwords("default", "en", ["Quanstate", "WebSocket"])
    pipeline, recorder, _ = build(settings, store)
    await pipeline.start()
    ready = recorder.of_type("session.ready")[0]
    assert "Quanstate" in ready["hotwords"]
    assert "WebSocket" in ready["hotwords"]
    await pipeline.close()


async def test_invalid_language_pair_is_rejected(settings: Settings, store: MemoryStore) -> None:
    engines = EngineSet(
        translator=CachedTranslator(MemoryTranslator(store)),
        transcriber=ScriptedTranscriber(),
        synthesizer=ToneSynthesizer(),
        translation_provider="memory+cache",
        stt_provider="scripted",
        tts_provider="tone",
    )
    config = SessionConfig(session_id="x", source="en", target="en")
    with pytest.raises(LanguageError):
        DuplexPipeline(config, engines, store, Recorder().send, Recorder().send_audio, settings)


async def test_partial_hypotheses_are_emitted_while_speaking(settings: Settings, store: MemoryStore) -> None:
    class StreamingFake:
        name = "streaming-fake"
        supports_partials = True

        async def transcribe(self, samples, sample_rate, language, hotwords=(), *, partial=False):
            text = "where is the" if partial else "where is the bathroom?"
            return Transcription(text=text, language=language, confidence=0.9, duration_ms=len(samples) / sample_rate * 1000)

        async def close(self) -> None:
            return None

    engines = EngineSet(
        translator=CachedTranslator(MemoryTranslator(store)),
        transcriber=StreamingFake(),
        synthesizer=ToneSynthesizer(),
        translation_provider="memory+cache",
        stt_provider="streaming-fake",
        tts_provider="tone",
    )
    recorder = Recorder()
    config = SessionConfig(session_id="partial", source="en", target="es")
    pipeline = DuplexPipeline(config, engines, store, recorder.send, recorder.send_audio, settings)
    await pipeline.start()
    speech = np.concatenate([tone(1.4), silence(0.4)])
    for start in range(0, speech.size, 3_200):
        await pipeline.feed_audio(pcm_bytes(speech[start : start + 3_200]))
        await asyncio.sleep(0)
    await asyncio.wait_for(pipeline.drain(), timeout=3)

    partials = recorder.of_type("stt.partial")
    assert partials, "expected at least one partial hypothesis"
    assert partials[0]["text"] == "where is the"
    await pipeline.close()


async def test_metrics_report_respects_budget(settings: Settings, store: MemoryStore) -> None:
    pipeline, recorder, _ = build(settings, store)
    await pipeline.start()
    for text in ["hello", "thank you", "where is the bathroom?"]:
        await pipeline.feed_text(text)
    await asyncio.wait_for(pipeline.drain(), timeout=3)
    stats = await pipeline.stats()
    assert stats["latency"]["budget"]["ok"] is True
    assert stats["counters"]["translations"] == 3
    await pipeline.close()


async def test_audio_ingest_hot_path_stays_under_five_milliseconds(settings: Settings, store: MemoryStore) -> None:
    pipeline, recorder, _ = build(settings, store)
    await pipeline.start()
    frame = pcm_bytes(tone(0.02))
    durations: list[float] = []
    for _ in range(300):
        started = time.perf_counter()
        await pipeline.feed_audio(frame)
        durations.append((time.perf_counter() - started) * 1000)
    await pipeline.feed_audio(pcm_bytes(silence(0.4)))
    await asyncio.wait_for(pipeline.drain(), timeout=3)

    durations.sort()
    p95 = durations[int(len(durations) * 0.95) - 1]
    ingest = pipeline.metrics.summary()["audio_ingest"]
    print(f"\nAUDIO INGEST p95={p95:.3f}ms max={durations[-1]:.3f}ms frames={pipeline.counters.frames}")
    assert p95 < settings.latency_budget.fast_path_ms
    assert ingest["p95"] < settings.latency_budget.fast_path_ms
    assert pipeline.counters.frames >= 300
    await pipeline.close()
