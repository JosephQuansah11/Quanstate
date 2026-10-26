from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

from quanstate.learning.documents import DocumentError, extract_document_text
from quanstate.learning.store import MemoryStore, StoreError
from quanstate.learning.text import (
    extract_phrase_pairs,
    extract_srt_cues,
    extract_terms,
    normalize_phrase,
    split_sentences,
)
from quanstate.learning.youtube import (
    HttpYouTubeFetcher,
    TranscriptSegment,
    YouTubeError,
    YouTubeLearner,
    parse_video_id,
)


def test_phrase_pairs_support_common_glossary_formats() -> None:
    text = """
# comment line
hello = hola
thank you | gracias
where is the station\tdónde está la estación
rollout => despliegue
not a pair
"""
    pairs = extract_phrase_pairs(text)
    assert [(pair.source, pair.target) for pair in pairs] == [
        ("hello", "hola"),
        ("thank you", "gracias"),
        ("where is the station", "dónde está la estación"),
        ("rollout", "despliegue"),
    ]


def test_phrase_pairs_deduplicate_and_normalise() -> None:
    pairs = extract_phrase_pairs("Hello = hola\nhello = hola\n  Hello   =  hola  ")
    assert len(pairs) == 1
    assert normalize_phrase("  Hello   World ") == "hello world"


def test_sentence_split_and_srt_cues() -> None:
    assert split_sentences("One. Two! Three?") == ["One.", "Two!", "Three?"]
    srt = """1
00:00:01,000 --> 00:00:02,000
Hello there

2
00:00:03,000 --> 00:00:04,000
General Kenobi
"""
    assert extract_srt_cues(srt) == ["Hello there", "General Kenobi"]


def test_term_extraction_ranks_domain_vocabulary() -> None:
    text = (
        "Quanstate Gateway handles WebSocket streaming. The Quanstate Gateway connects to NLLB-200. "
        "Use the Quanstate Gateway for low latency."
    )
    terms = [term for term, _score in extract_terms(text, "en")]
    assert "Quanstate Gateway" in terms
    assert any("NLLB" in term for term in terms)


def test_plain_text_and_markdown_documents() -> None:
    text, kind = extract_document_text("notes.md", b"# Title\nhello = hola")
    assert kind == "md"
    assert "hello = hola" in text
    json_text, _ = extract_document_text("pairs.json", json.dumps({"phrases": [{"text": "hola"}]}).encode())
    assert "hola" in json_text


def test_html_srt_and_docx_documents() -> None:
    html, kind = extract_document_text("page.html", b"<html><body><p>hello = hola</p></body></html>")
    assert kind == "html"
    assert "hello = hola" in html

    srt = b"1\n00:00:00,000 --> 00:00:01,000\nhola\n"
    srt_text, _ = extract_document_text("captions.srt", srt)
    assert srt_text.strip() == "hola"

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document><w:body><w:p><w:r><w:t>Hello = Hola</w:t></w:r></w:p></w:document>',
        )
    docx_text, kind = extract_document_text("glossary.docx", buffer.getvalue())
    assert kind == "docx"
    assert docx_text.strip() == "Hello = Hola"


def test_unsupported_and_corrupt_documents() -> None:
    with pytest.raises(DocumentError):
        extract_document_text("image.png", b"123")
    with pytest.raises(DocumentError):
        extract_document_text("broken.docx", b"not-a-zip")


def test_store_learns_phrases_glossary_and_hotwords(store: MemoryStore) -> None:
    record = store.learn_text(
        "default",
        "en",
        "es",
        "hello = hola\nQuanstate Gateway = Puerta Quanstate\nQuanstate Gateway streams WebSocket audio.",
        origin="document",
        title="Product glossary",
    )
    assert record["phrasesAdded"] == 4  # both directions, two pairs
    assert record["glossaryAdded"] == 2
    assert record["hotwordsAdded"] > 0
    snapshot = store.snapshot("default")
    assert snapshot.phrase("en", "es", "hello") == ("hola", 1.5, "document")
    assert snapshot.phrase("es", "en", "hola") is not None
    assert snapshot.glossary[("en", "es", "quanstate gateway")] == "Puerta Quanstate"
    assert "Quanstate" in snapshot.hotwords["en"]
    assert snapshot.stats["documents"] == 1


def test_store_persists_across_instances(tmp_path: Path) -> None:
    directory = tmp_path / "memory"
    first = MemoryStore(directory)
    first.add_phrases("travel", "en", "es", [("boarding pass", "tarjeta de embarque")])
    second = MemoryStore(directory)
    snapshot = second.snapshot("travel")
    assert snapshot.phrase("en", "es", "boarding pass")[0] == "tarjeta de embarque"
    assert "travel" in second.profiles()


def test_profiles_are_isolated_and_resettable(store: MemoryStore) -> None:
    store.add_phrases("alice", "en", "es", [("invoice", "factura")])
    assert store.snapshot("bob").phrase("en", "es", "invoice") is None
    store.reset("alice")
    assert store.snapshot("alice").phrase("en", "es", "invoice") is None


def test_invalid_profile_names_are_rejected(store: MemoryStore) -> None:
    with pytest.raises(StoreError):
        store.snapshot("../escape")


def test_youtube_id_parsing() -> None:
    assert parse_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert parse_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert parse_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert parse_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    with pytest.raises(YouTubeError):
        parse_video_id("https://example.com/nope")


def test_json3_caption_parsing() -> None:
    payload = json.dumps(
        {
            "events": [
                {"tStartMs": 0, "dDurationMs": 1200, "segs": [{"utf8": "hello "}, {"utf8": "there"}]},
                {"tStartMs": 1200, "dDurationMs": 900, "segs": [{"utf8": "general "}, {"utf8": "kenobi"}]},
                {"tStartMs": 2000, "dDurationMs": 500, "segs": []},
            ]
        }
    )
    segments = HttpYouTubeFetcher.parse_json3(payload)
    assert [segment.text for segment in segments] == ["hello there", "general kenobi"]
    assert segments[0].end_ms == 1200


class FakeFetcher:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str | None]] = []

    async def fetch(self, video_id: str, language: str, translate_to: str | None = None):
        self.calls.append((video_id, language, translate_to))
        if translate_to == "es" or language == "es":
            return "es", [
                TranscriptSegment(0, 1000, "La puerta Quanstate transmite WebSockets"),
                TranscriptSegment(1000, 2000, "hola"),
            ]
        return "en", [
            TranscriptSegment(0, 1000, "Quanstate Gateway uses WebSockets"),
            TranscriptSegment(1000, 2000, "hello"),
        ]


async def test_youtube_learner_uses_parallel_captions(store: MemoryStore) -> None:
    fetcher = FakeFetcher()
    learner = YouTubeLearner(store, fetcher)
    record = await learner.learn("https://youtu.be/dQw4w9WgXcQ", "en", "es", profile="default")
    assert record["videoId"] == "dQw4w9WgXcQ"
    assert record["segments"] == 2
    assert record["bilingualPairs"] == 2
    assert len(fetcher.calls) == 2
    assert store.snapshot("default").phrase("en", "es", "Quanstate Gateway uses WebSockets") is not None
    assert store.snapshot("default").stats["documents"] == 1


async def test_youtube_learner_mines_bilingual_track(store: MemoryStore) -> None:
    class BilingualFetcher:
        async def fetch(self, video_id: str, language: str, translate_to: str | None = None):
            if translate_to is not None:
                raise YouTubeError("translated track unavailable")
            if language == "es":
                return "es", [TranscriptSegment(0, 1000, "Puerta Quanstate usa WebSockets")]
            return "en", [TranscriptSegment(0, 1000, "Quanstate Gateway uses WebSockets")]

    learner = YouTubeLearner(store, BilingualFetcher())
    record = await learner.learn("dQw4w9WgXcQ", "en", "es")
    assert record["bilingualPairs"] == 1
    snapshot = store.snapshot("default")
    assert snapshot.phrase("en", "es", "Quanstate Gateway uses WebSockets") is not None
    assert snapshot.phrase("es", "en", "Puerta Quanstate usa WebSockets") is not None
