from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from quanstate.config import Settings
from quanstate.engines.registry import EngineSet
from quanstate.learning.store import MemoryStore
from quanstate.learning.youtube import TranscriptSegment
from quanstate.protocol import PROTOCOL_VERSION
from quanstate.server import create_app
from tests.conftest import pcm_bytes, silence, tone


class FakeFetcher:
    async def fetch(self, video_id: str, language: str, translate_to: str | None = None):
        if translate_to == "es" or language == "es":
            return "es", [TranscriptSegment(0, 1200, "La puerta Quanstate transmite audio")]
        return "en", [TranscriptSegment(0, 1200, "Quanstate Gateway streams audio")]


@pytest.fixture
def client(settings: Settings, store: MemoryStore, engines: EngineSet):
    app = create_app(settings=settings, store=store, engines=engines, youtube_fetcher=FakeFetcher())
    with TestClient(app) as test_client:
        yield test_client


def test_health_languages_and_capabilities(client: TestClient) -> None:
    health = client.get("/v1/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert health.json()["engines"]["translation"] == "memory+cache"

    languages = client.get("/v1/languages").json()
    assert languages["version"] == 1
    assert any(language["code"] == "es" for language in languages["languages"])

    capabilities = client.get("/v1/capabilities").json()
    assert capabilities["protocolVersion"] == PROTOCOL_VERSION
    assert capabilities["capabilities"]["speechToText"]["provider"] == "scripted"


def test_translate_endpoint_and_cache(client: TestClient) -> None:
    payload = {"text": "where is the bathroom?", "sourceLang": "en", "targetLang": "es"}
    first = client.post("/v1/translate", json=payload)
    assert first.status_code == 200
    body = first.json()
    assert body["text"] == "¿dónde está el baño?"
    assert body["cached"] is False
    assert body["latencyMs"] < 100

    second = client.post("/v1/translate", json=payload).json()
    assert second["cached"] is True
    assert second["latencyMs"] < 5


def test_translate_rejects_bad_languages(client: TestClient) -> None:
    response = client.post("/v1/translate", json={"text": "hello", "sourceLang": "en", "targetLang": "en"})
    assert response.status_code == 400
    response = client.post("/v1/translate", json={"text": "hello", "sourceLang": "en", "targetLang": "xx"})
    assert response.status_code == 400


def test_tts_returns_playable_wav(client: TestClient) -> None:
    response = client.post("/v1/tts", json={"text": "hola mundo", "language": "es"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    assert response.content.startswith(b"RIFF")
    assert len(response.content) > 10_000


def test_document_upload_teaches_memory(client: TestClient) -> None:
    document = b"hello = hola\nQuanstate Gateway = Puerta Quanstate\n"
    response = client.post(
        "/v1/learn/documents",
        files={"file": ("glossary.txt", document, "text/plain")},
        data={"sourceLang": "en", "targetLang": "es", "profile": "default"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["document"]["phrasesAdded"] == 4
    assert body["memory"]["stats"]["documents"] == 1

    translation = client.post(
        "/v1/translate", json={"text": "Quanstate Gateway", "sourceLang": "en", "targetLang": "es"}
    ).json()
    assert translation["text"] == "Puerta Quanstate"

    memory = client.get("/v1/memory/default").json()
    assert any(term["source"] == "Quanstate Gateway" for term in memory["glossary"])


@pytest.mark.parametrize("filename", ["notes.txt", "captions.srt", "words.csv", "data.json", "page.html"])
def test_supported_text_documents(client: TestClient, filename: str) -> None:
    response = client.post(
        "/v1/learn/documents",
        files={"file": (filename, b"invoice = factura\n", "text/plain")},
        data={"sourceLang": "en", "targetLang": "es"},
    )
    assert response.status_code == 200, response.text


def test_unsupported_document_type(client: TestClient) -> None:
    response = client.post(
        "/v1/learn/documents",
        files={"file": ("image.png", b"not an image", "image/png")},
        data={"sourceLang": "en", "targetLang": "es"},
    )
    assert response.status_code == 400


def test_youtube_learning_with_injected_fetcher(client: TestClient) -> None:
    response = client.post(
        "/v1/learn/youtube",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "sourceLang": "en", "targetLang": "es"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["document"]["kind"] == "youtube"
    assert body["document"]["segments"] == 1
    translation = client.post(
        "/v1/translate", json={"text": "Quanstate Gateway streams audio", "sourceLang": "en", "targetLang": "es"}
    ).json()
    assert translation["text"] == "La puerta Quanstate transmite audio"


def test_memory_reset(client: TestClient) -> None:
    client.post("/v1/learn/text", json={"text": "invoice = factura", "sourceLang": "en", "targetLang": "es"})
    assert client.get("/v1/memory/default").json()["stats"]["documents"] == 1
    reset = client.request("DELETE", "/v1/memory/default")
    assert reset.status_code == 200
    assert reset.json()["stats"]["documents"] == 0


def test_websocket_text_session(client: TestClient) -> None:
    with client.websocket_connect("/v1/realtime") as ws:
        ws.send_json(
            {
                "type": "session.start",
                "sourceLang": "en",
                "targetLang": "es",
                "sampleRate": 16_000,
                "ttsMode": "client",
                "profile": "default",
            }
        )
        ready = ws.receive_json()
        assert ready["type"] == "session.ready"
        assert ready["protocolVersion"] == PROTOCOL_VERSION
        assert ready["memory"]["phrases"] > 0

        ws.send_json({"type": "ping", "t": 123})
        pong = ws.receive_json()
        assert pong["type"] == "pong"
        assert pong["t"] == 123

        ws.send_json({"type": "text.input", "text": "hello"})
        final = ws.receive_json()
        translation = ws.receive_json()
        assert final["type"] == "stt.final"
        assert final["text"] == "hello"
        assert final["engine"] == "client"
        assert translation["type"] == "translation"
        assert translation["text"] == "hola"
        assert translation["latency"]["endToEndMs"] < 100

        ws.send_json({"type": "config.update", "targetLang": "fr"})
        updated = ws.receive_json()
        assert updated["type"] == "config.updated"
        assert updated["targetLang"] == "fr"

        ws.send_json({"type": "text.input", "text": "hello"})
        assert ws.receive_json()["type"] == "stt.final"
        assert ws.receive_json()["text"] == "bonjour"

        ws.send_json({"type": "session.stop"})
        stats = ws.receive_json()
        stopped = ws.receive_json()
        assert stats["type"] == "stats"
        assert stats["counters"]["translations"] == 2
        assert stopped["type"] == "session.stopped"


def test_websocket_audio_session(client: TestClient) -> None:
    with client.websocket_connect("/v1/realtime") as ws:
        ws.send_json({"type": "session.start", "sourceLang": "en", "targetLang": "es", "ttsMode": "server"})
        assert ws.receive_json()["type"] == "session.ready"

        audio = pcm_bytes(__import__("numpy").concatenate([tone(0.5), silence(0.5)]))
        for start in range(0, len(audio), 4096):
            ws.send_bytes(audio[start : start + 4096])
        ws.send_json({"type": "audio.flush"})

        seen: list[dict[str, Any]] = []
        binary_frames = 0
        while True:
            message = ws.receive()
            if "bytes" in message and message["bytes"] is not None:
                binary_frames += 1
                continue
            payload = __import__("json").loads(message["text"])
            seen.append(payload)
            if payload["type"] == "tts.end":
                break
        types = [event["type"] for event in seen]
        assert types[0] == "stt.final"
        assert "translation" in types
        assert "tts.start" in types
        assert binary_frames > 0
        assert seen[[event["type"] for event in seen].index("translation")]["text"] == "¿dónde está el baño?"


def test_websocket_rejects_bad_messages(client: TestClient) -> None:
    with client.websocket_connect("/v1/realtime") as ws:
        ws.send_text("not json")
        error = ws.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "bad_message"

        ws.send_json({"type": "text.input", "text": "hello"})
        error = ws.receive_json()
        assert error["code"] == "no_session"

        ws.send_json({"type": "session.start", "sourceLang": "en", "targetLang": "es"})
        ws.receive_json()
        ws.send_json({"type": "config.update", "targetLang": "en"})
        error = ws.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "config_error"


def test_metrics_endpoint(client: TestClient) -> None:
    client.post("/v1/translate", json={"text": "hello", "sourceLang": "en", "targetLang": "es"})
    payload = client.get("/v1/metrics").json()
    assert "stages" in payload["service"]
    assert payload["budget"]["end_to_end_ms"] == 100
    assert payload["engines"]["textToSpeech"] == "tone"


WEB_DIST = Path(__file__).resolve().parents[2] / "apps" / "web" / "dist"


@pytest.mark.skipif(not WEB_DIST.exists(), reason="web bundle has not been built")
def test_built_web_app_is_served_by_the_api(client: TestClient) -> None:
    index = client.get("/")
    assert index.status_code == 200
    assert "Quanstate" in index.text
    health = client.get("/v1/health")
    assert health.headers["content-type"].startswith("application/json")
