"""Runtime configuration for the Quanstate realtime service."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE_DIR.parent.parent


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


@dataclass(frozen=True)
class LatencyBudget:
    """Per-stage budgets in milliseconds.

    The product target is a 100 ms end-to-end experience and a 5 ms hot path.
    The hot path (cache hit / known phrase / on-device partial) must stay inside
    ``fast_path_ms``.  ML inference is never 5 ms, so the pipeline keeps neural
    work off the hot path and streams partials as soon as they exist.
    """

    fast_path_ms: float = 5.0
    end_to_end_ms: float = 100.0
    stt_ms: float = 55.0
    translation_ms: float = 5.0
    tts_first_byte_ms: float = 30.0
    frame_ms: float = 20.0


@dataclass(frozen=True)
class Settings:
    sample_rate: int = 16_000
    frame_ms: int = 20
    max_frame_bytes: int = 1_000_000
    audio_queue_size: int = 64
    tts_mode: str = "client"  # "client" | "server"
    stt_provider: str = "auto"  # auto | faster-whisper | http | scripted | none
    translation_provider: str = "auto"  # auto | memory | nllb | http
    tts_provider: str = "auto"  # auto | piper | tone
    whisper_model: str = "tiny"
    whisper_compute_type: str = "int8"
    stt_http_url: str = ""
    translate_http_url: str = ""
    tts_http_url: str = ""
    nllb_model: str = "facebook/nllb-200-distilled-600M"
    piper_voice_dir: str = ""
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("QUANSTATE_DATA_DIR", str(PACKAGE_DIR.parent / "data" / "runtime"))))
    max_cache_entries: int = 4096
    cors_origins: tuple[str, ...] = ("*",)
    latency_budget: LatencyBudget = field(default_factory=LatencyBudget)


def load_settings() -> Settings:
    budget = LatencyBudget(
        fast_path_ms=_env_float("QUANSTATE_FAST_PATH_MS", 5.0),
        end_to_end_ms=_env_float("QUANSTATE_E2E_MS", 100.0),
        stt_ms=_env_float("QUANSTATE_STT_MS", 55.0),
        translation_ms=_env_float("QUANSTATE_TRANSLATION_MS", 5.0),
        tts_first_byte_ms=_env_float("QUANSTATE_TTS_MS", 30.0),
    )
    return Settings(
        sample_rate=_env_int("QUANSTATE_SAMPLE_RATE", 16_000),
        frame_ms=_env_int("QUANSTATE_FRAME_MS", 20),
        audio_queue_size=_env_int("QUANSTATE_AUDIO_QUEUE", 64),
        tts_mode=os.environ.get("QUANSTATE_TTS_MODE", "client"),
        stt_provider=os.environ.get("QUANSTATE_STT", "auto"),
        translation_provider=os.environ.get("QUANSTATE_TRANSLATOR", "auto"),
        tts_provider=os.environ.get("QUANSTATE_TTS", "auto"),
        whisper_model=os.environ.get("QUANSTATE_WHISPER_MODEL", "tiny"),
        stt_http_url=os.environ.get("QUANSTATE_STT_HTTP_URL", ""),
        translate_http_url=os.environ.get("QUANSTATE_TRANSLATE_HTTP_URL", ""),
        tts_http_url=os.environ.get("QUANSTATE_TTS_HTTP_URL", ""),
        nllb_model=os.environ.get("QUANSTATE_NLLB_MODEL", "facebook/nllb-200-distilled-600M"),
        piper_voice_dir=os.environ.get("QUANSTATE_PIPER_VOICES", ""),
        data_dir=Path(os.environ.get("QUANSTATE_DATA_DIR", str(PACKAGE_DIR.parent / "data" / "runtime"))),
        max_cache_entries=_env_int("QUANSTATE_CACHE_ENTRIES", 4096),
        latency_budget=budget,
    )


SETTINGS = load_settings()
