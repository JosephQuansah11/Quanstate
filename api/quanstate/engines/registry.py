"""Engine selection from configuration, with graceful degradation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from ..config import Settings
from ..learning.store import MemoryStore
from .base import Synthesizer, Transcriber, Translator
from .synthesizer import PiperSynthesizer, ToneSynthesizer
from .transcriber import FasterWhisperTranscriber, HttpWhisperTranscriber, NullTranscriber, ScriptedTranscriber
from .translator import CachedTranslator, ChainTranslator, HttpTranslator, MemoryTranslator, NllbTranslator


@dataclass(frozen=True)
class EngineSet:
    translator: Translator
    transcriber: Transcriber
    synthesizer: Synthesizer
    translation_provider: str
    stt_provider: str
    tts_provider: str


def build_translator(settings: Settings, store: MemoryStore) -> Translator:
    provider = (settings.translation_provider or "auto").lower()
    memory = MemoryTranslator(store)
    engines: list[Translator] = [memory]

    if provider == "http" or (provider == "auto" and settings.translate_http_url):
        if settings.translate_http_url:
            engines.append(HttpTranslator(settings.translate_http_url))
    elif provider == "nllb":
        engines = [NllbTranslator(settings.nllb_model)]
    elif provider in {"memory", "auto"}:
        engines = [memory]
    else:
        raise ValueError(f"unknown translation provider: {provider}")

    base: Translator = engines[0] if len(engines) == 1 else ChainTranslator(engines)
    return CachedTranslator(base, settings.max_cache_entries)


def build_transcriber(settings: Settings, cues: Sequence[str] | None = None) -> Transcriber:
    provider = (settings.stt_provider or "auto").lower()
    if provider == "scripted":
        return ScriptedTranscriber(cues)
    if provider == "none":
        return NullTranscriber()
    if provider == "faster-whisper":
        return FasterWhisperTranscriber(settings.whisper_model, settings.whisper_compute_type)
    if provider == "http":
        return HttpWhisperTranscriber(settings.stt_http_url)
    if provider == "auto":
        if FasterWhisperTranscriber.available():
            return FasterWhisperTranscriber(settings.whisper_model, settings.whisper_compute_type)
        if settings.stt_http_url:
            return HttpWhisperTranscriber(settings.stt_http_url)
        return NullTranscriber()
    raise ValueError(f"unknown STT provider: {provider}")


def build_synthesizer(settings: Settings) -> Synthesizer:
    provider = (settings.tts_provider or "auto").lower()
    if provider == "piper":
        return PiperSynthesizer(settings.piper_voice_dir)
    if provider == "tone":
        return ToneSynthesizer()
    if provider == "auto":
        return ToneSynthesizer()
    raise ValueError(f"unknown TTS provider: {provider}")


def build_engine_set(
    settings: Settings, store: MemoryStore, cues: Sequence[str] | None = None
) -> EngineSet:
    translator = build_translator(settings, store)
    transcriber = build_transcriber(settings, cues)
    synthesizer = build_synthesizer(settings)
    return EngineSet(
        translator=translator,
        transcriber=transcriber,
        synthesizer=synthesizer,
        translation_provider=translator.name,
        stt_provider=transcriber.name,
        tts_provider=synthesizer.name,
    )


def capabilities(settings: Settings, engines: EngineSet) -> dict[str, object]:
    return {
        "translation": {
            "provider": engines.translation_provider,
            "cached": True,
            "maxCacheEntries": settings.max_cache_entries,
        },
        "speechToText": {
            "provider": engines.stt_provider,
            "partials": engines.transcriber.supports_partials,
            "onDeviceSupported": True,
        },
        "textToSpeech": {
            "provider": engines.tts_provider,
            "clientNative": True,
            "serverStreaming": True,
        },
        "learning": {
            "documents": True,
            "youtube": True,
        },
        "latency": {
            "fastPathMs": settings.latency_budget.fast_path_ms,
            "endToEndMs": settings.latency_budget.end_to_end_ms,
            "frameMs": settings.frame_ms,
        },
    }
