from __future__ import annotations

from pathlib import Path
import numpy as np
import pytest

from quanstate.config import LatencyBudget, Settings
from quanstate.engines.registry import EngineSet
from quanstate.engines.synthesizer import ToneSynthesizer
from quanstate.engines.transcriber import ScriptedTranscriber
from quanstate.engines.translator import CachedTranslator, MemoryTranslator
from quanstate.learning.store import MemoryStore


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        data_dir=tmp_path / "runtime",
        max_cache_entries=256,
        latency_budget=LatencyBudget(),
    )


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    return MemoryStore(tmp_path / "memory")


@pytest.fixture
def engines(store: MemoryStore, settings: Settings) -> EngineSet:
    translator = CachedTranslator(MemoryTranslator(store), settings.max_cache_entries)
    return EngineSet(
        translator=translator,
        transcriber=ScriptedTranscriber(["where is the bathroom?"]),
        synthesizer=ToneSynthesizer(),
        translation_provider=translator.name,
        stt_provider="scripted",
        tts_provider="tone",
    )


def tone(seconds: float = 0.4, sample_rate: int = 16_000, amplitude: float = 0.3, frequency: float = 440.0) -> np.ndarray:
    total = int(seconds * sample_rate)
    t = np.arange(total, dtype=np.float32) / sample_rate
    return (amplitude * np.sin(2 * np.pi * frequency * t)).astype(np.float32)


def silence(seconds: float, sample_rate: int = 16_000) -> np.ndarray:
    return np.zeros(int(seconds * sample_rate), dtype=np.float32)


def pcm_bytes(samples: np.ndarray) -> bytes:
    return (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()


@pytest.fixture
def speech_pcm() -> bytes:
    return pcm_bytes(np.concatenate([tone(0.5), silence(0.45)]))
