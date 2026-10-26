"""Wire protocol for the realtime duplex channel.

Control messages are JSON text frames.  Microphone audio is sent as *raw* binary
frames of little-endian PCM16 mono at the negotiated sample rate (16 kHz by
default) so the hot path never pays for base64 or multipart parsing.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

PROTOCOL_VERSION = 1

CLIENT_HELLO = "hello"
CLIENT_SESSION_START = "session.start"
CLIENT_SESSION_STOP = "session.stop"
CLIENT_AUDIO_FLUSH = "audio.flush"
CLIENT_TEXT_INPUT = "text.input"
CLIENT_CONFIG_UPDATE = "config.update"
CLIENT_PING = "ping"

SERVER_SESSION_READY = "session.ready"
SERVER_STT_PARTIAL = "stt.partial"
SERVER_STT_FINAL = "stt.final"
SERVER_TRANSLATION = "translation"
SERVER_TTS_START = "tts.start"
SERVER_TTS_END = "tts.end"
SERVER_PONG = "pong"
SERVER_STATS = "stats"
SERVER_ERROR = "error"

SUPPORTED_TTS_MODES = {"client", "server"}

MAX_TEXT_CHARS = 8_000


class MessageError(ValueError):
    """Raised for malformed or unsupported client messages."""


def now_ms() -> float:
    return time.perf_counter() * 1000.0


def new_id(prefix: str = "seg") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def encode(message: dict[str, Any]) -> str:
    return json.dumps(message, separators=(",", ":"), ensure_ascii=False)


def error(message: str, code: str = "bad_request", recoverable: bool = True) -> dict[str, Any]:
    return {"type": SERVER_ERROR, "code": code, "message": message, "recoverable": recoverable}


def pong(client_time: Any, server_time_ms: float | None = None) -> dict[str, Any]:
    return {
        "type": SERVER_PONG,
        "t": client_time,
        "serverTime": server_time_ms if server_time_ms is not None else now_ms(),
    }


def decode_client_message(raw: str | bytes) -> dict[str, Any]:
    if isinstance(raw, bytes):
        raise MessageError("binary frames are audio; control messages must be JSON text")
    try:
        message = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise MessageError(f"invalid JSON: {exc}") from exc
    if not isinstance(message, dict):
        raise MessageError("message must be a JSON object")
    kind = message.get("type")
    if not isinstance(kind, str) or not kind:
        raise MessageError("message.type is required")
    return message


@dataclass(frozen=True)
class SessionConfig:
    session_id: str
    source: str
    target: str
    sample_rate: int = 16_000
    tts_mode: str = "client"
    profile: str = "default"
    on_device_stt: bool = False
    locale_hint: str = ""
    hotwords: tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def from_message(cls, message: dict[str, Any], default_sample_rate: int = 16_000) -> "SessionConfig":
        kind = message.get("type")
        if kind not in (CLIENT_SESSION_START, CLIENT_HELLO):
            raise MessageError(f"expected {CLIENT_SESSION_START}, got {kind!r}")

        source = message.get("sourceLang") or message.get("source")
        target = message.get("targetLang") or message.get("target")
        if not isinstance(source, str) or not source.strip():
            raise MessageError("session.start requires sourceLang")
        if not isinstance(target, str) or not target.strip():
            raise MessageError("session.start requires targetLang")

        sample_rate = message.get("sampleRate", default_sample_rate)
        if not isinstance(sample_rate, int) or not (8_000 <= sample_rate <= 48_000):
            raise MessageError("sampleRate must be an integer between 8000 and 48000")

        tts_mode = message.get("ttsMode", "client")
        if tts_mode not in SUPPORTED_TTS_MODES:
            raise MessageError(f"ttsMode must be one of {sorted(SUPPORTED_TTS_MODES)}")

        session_id = message.get("sessionId") or new_id("sess")
        if not isinstance(session_id, str) or len(session_id) > 128:
            raise MessageError("sessionId must be a short string")

        profile = message.get("profile") or "default"
        if not isinstance(profile, str) or len(profile) > 64:
            raise MessageError("profile must be a short string")

        features = message.get("features") or {}
        if not isinstance(features, dict):
            raise MessageError("features must be an object")

        raw_hotwords = message.get("hotwords") or []
        if not isinstance(raw_hotwords, list) or not all(isinstance(word, str) for word in raw_hotwords):
            raise MessageError("hotwords must be a list of strings")

        return cls(
            session_id=session_id,
            source=source.strip().lower(),
            target=target.strip().lower(),
            sample_rate=sample_rate,
            tts_mode=tts_mode,
            profile=profile,
            on_device_stt=bool(features.get("onDeviceStt", False)),
            locale_hint=str(message.get("localeHint") or ""),
            hotwords=tuple(word.strip()[:64] for word in raw_hotwords[:256] if word.strip()),
        )


def text_input(message: dict[str, Any]) -> tuple[str, str | None]:
    """Return ``(text, forced_id)`` for a ``text.input`` / ``text.final`` frame."""

    kind = message.get("type")
    if kind not in (CLIENT_TEXT_INPUT, "text.final"):
        raise MessageError(f"expected {CLIENT_TEXT_INPUT}, got {kind!r}")
    text = message.get("text")
    if not isinstance(text, str) or not text.strip():
        raise MessageError("text.input requires non-empty text")
    if len(text) > MAX_TEXT_CHARS:
        raise MessageError(f"text.input is limited to {MAX_TEXT_CHARS} characters")
    segment_id = message.get("id")
    if segment_id is not None and not isinstance(segment_id, str):
        raise MessageError("id must be a string")
    return text.strip(), segment_id
