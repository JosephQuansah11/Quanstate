"""Engine contracts shared by the translator, transcriber and voice engines."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol, Sequence

import numpy as np


class EngineError(RuntimeError):
    """Raised when an engine cannot serve a request (missing model, bad config)."""


@dataclass(frozen=True)
class TranslationHints:
    profile: str = "default"
    memory_version: int = 0
    hotwords: tuple[str, ...] = ()
    domain: str = ""


@dataclass(frozen=True)
class Translation:
    text: str
    source_text: str
    source_lang: str
    target_lang: str
    engine: str
    confidence: float = 1.0
    coverage: float = 1.0
    cached: bool = False
    glossary_hits: tuple[str, ...] = field(default_factory=tuple)
    latency_ms: float = 0.0
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Transcription:
    text: str
    language: str
    confidence: float = 0.0
    duration_ms: float = 0.0
    detail: dict[str, Any] = field(default_factory=dict)


class Translator(Protocol):
    name: str

    async def translate(
        self, text: str, source_lang: str, target_lang: str, hints: TranslationHints | None = None
    ) -> Translation: ...

    async def warmup(self) -> None: ...

    async def close(self) -> None: ...


class Transcriber(Protocol):
    name: str
    supports_partials: bool

    async def transcribe(
        self,
        samples: np.ndarray,
        sample_rate: int,
        language: str,
        hotwords: Sequence[str] = (),
        *,
        partial: bool = False,
    ) -> Transcription: ...

    async def close(self) -> None: ...


class Synthesizer(Protocol):
    name: str

    def stream(self, text: str, language: str) -> AsyncIterator[np.ndarray]: ...

    async def close(self) -> None: ...
