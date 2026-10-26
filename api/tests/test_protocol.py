from __future__ import annotations

import pytest

from quanstate.protocol import (
    CLIENT_HELLO,
    CLIENT_SESSION_START,
    MessageError,
    SessionConfig,
    decode_client_message,
    encode,
    error,
    pong,
    text_input,
)


def test_decode_valid_json_object() -> None:
    message = decode_client_message('{"type": "ping", "t": 5}')
    assert message["type"] == "ping"
    with pytest.raises(MessageError):
        decode_client_message(b'{"type": "ping"}')
    with pytest.raises(MessageError):
        decode_client_message("{bad json}")
    with pytest.raises(MessageError):
        decode_client_message("[]")
    with pytest.raises(MessageError):
        decode_client_message('{"t": 1}')


def test_session_config_defaults_and_validation() -> None:
    config = SessionConfig.from_message(
        {"type": CLIENT_SESSION_START, "sourceLang": "EN", "targetLang": "es-MX", "ttsMode": "server"}
    )
    assert config.source == "en"
    assert config.target == "es-mx"
    assert config.sample_rate == 16_000
    assert config.tts_mode == "server"
    assert config.session_id.startswith("sess_")
    assert config.profile == "default"

    hello = SessionConfig.from_message({"type": CLIENT_HELLO, "sourceLang": "fr", "targetLang": "de"})
    assert hello.source == "fr"

    with pytest.raises(MessageError):
        SessionConfig.from_message({"type": CLIENT_SESSION_START, "sourceLang": "en"})
    with pytest.raises(MessageError):
        SessionConfig.from_message({"type": CLIENT_SESSION_START, "sourceLang": "en", "targetLang": "es", "sampleRate": 1})
    with pytest.raises(MessageError):
        SessionConfig.from_message({"type": CLIENT_SESSION_START, "sourceLang": "en", "targetLang": "es", "ttsMode": "loud"})
    with pytest.raises(MessageError):
        SessionConfig.from_message({"type": CLIENT_SESSION_START, "sourceLang": "en", "targetLang": "es", "hotwords": "nope"})


def test_hotwords_are_trimmed_and_cleaned() -> None:
    config = SessionConfig.from_message(
        {
            "type": "session.start",
            "sourceLang": "en",
            "targetLang": "es",
            "hotwords": ["  Quanstate  ", "", "x" * 200],
        }
    )
    assert config.hotwords == ("Quanstate", "x" * 64)


def test_text_input_validation() -> None:
    assert text_input({"type": "text.input", "text": "  hola  "}) == ("hola", None)
    assert text_input({"type": "text.final", "text": "hi", "id": "u1"}) == ("hi", "u1")
    with pytest.raises(MessageError):
        text_input({"type": "text.input", "text": "   "})
    with pytest.raises(MessageError):
        text_input({"type": "ping", "text": "hi"})
    with pytest.raises(MessageError):
        text_input({"type": "text.input", "text": "x" * 8_001})


def test_encode_is_compact_and_roundtrips() -> None:
    payload = error("boom", code="internal")
    assert encode(payload) == '{"type":"error","code":"internal","message":"boom","recoverable":true}'
    assert pong(42)["t"] == 42


def test_cors_origins_come_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    from quanstate.config import load_settings

    monkeypatch.setenv("QUANSTATE_CORS_ORIGINS", "https://app.example.com, https://admin.example.com")
    settings = load_settings()
    assert settings.cors_origins == ("https://app.example.com", "https://admin.example.com")

    monkeypatch.setenv("QUANSTATE_CORS_ORIGINS", "  ")
    assert load_settings().cors_origins == ("*",)
