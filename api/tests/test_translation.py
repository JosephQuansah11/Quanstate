from __future__ import annotations

import time

import pytest

from quanstate.config import LatencyBudget
from quanstate.engines.base import EngineError, Translation, TranslationHints
from quanstate.engines.translator import (
    CachedTranslator,
    ChainTranslator,
    MemoryTranslator,
    _is_word,
    _stem_variants,
)
from quanstate.learning.store import MemoryStore


@pytest.fixture
def translator(store: MemoryStore) -> MemoryTranslator:
    store.snapshot("default")  # warm the immutable snapshot like the service does on session.ready
    return MemoryTranslator(store)


async def test_exact_phrase_uses_seed_memory(translator: MemoryTranslator) -> None:
    result = await translator.translate("hello", "en", "es")
    assert result.text == "hola"
    assert result.confidence == 1.0
    assert result.coverage == 1.0
    assert result.glossary_hits == ()
    assert result.latency_ms < 5


async def test_phrase_ignores_redundant_trailing_punctuation(translator: MemoryTranslator) -> None:
    result = await translator.translate("Where is the bathroom?", "en", "es")
    assert result.text == "¿dónde está el baño?"
    assert result.text.count("?") == 1


async def test_word_level_fallback_and_unknown_terms(translator: MemoryTranslator) -> None:
    result = await translator.translate("the coffee is cold", "en", "es")
    assert "café" in result.text
    assert "frío" in result.text
    assert result.coverage > 0.5
    unknown = await translator.translate("Quanstate nanobots", "en", "es")
    assert "Quanstate" in unknown.text
    assert unknown.confidence < 1
    assert unknown.detail["knownWords"] < unknown.detail["words"]


async def test_reverse_pair_uses_seed(translator: MemoryTranslator) -> None:
    result = await translator.translate("gracias", "es", "en")
    assert result.text.lower() == "thank you"


async def test_learning_changes_translation_and_invalidates_cache(store: MemoryStore) -> None:
    cached = CachedTranslator(MemoryTranslator(store))
    old_hints = TranslationHints(profile="default", memory_version=store.snapshot("default").version)
    before = await cached.translate("the rollout window", "en", "es", old_hints)
    assert before.coverage < 1.0

    store.learn_text(
        "default",
        "en",
        "es",
        "the rollout window = la ventana de despliegue\nQuanstate Gateway = Puerta Quanstate",
        origin="document",
    )
    new_hints = TranslationHints(profile="default", memory_version=store.snapshot("default").version)
    after = await cached.translate("the rollout window", "en", "es", new_hints)
    assert after.text == "la ventana de despliegue"
    assert after.confidence == 1.0
    assert after.cached is False

    again = await cached.translate("the rollout window", "en", "es", new_hints)
    assert again.cached is True  # new version is now warm


async def test_glossary_term_protected_inside_sentence(store: MemoryStore) -> None:
    store.add_glossary("default", "en", "es", {"Quanstate Gateway": "Puerta Quanstate"})
    translator = MemoryTranslator(store)
    result = await translator.translate("connect to the Quanstate Gateway now", "en", "es")
    assert "Puerta Quanstate" in result.text
    assert result.glossary_hits


async def test_cached_translation_stays_under_five_milliseconds(store: MemoryStore) -> None:
    cached = CachedTranslator(MemoryTranslator(store))
    hints = TranslationHints(profile="default", memory_version=store.snapshot("default").version)
    await cached.translate("where is the train station?", "en", "es", hints)
    durations = []
    for _ in range(200):
        started = time.perf_counter()
        result = await cached.translate("where is the train station?", "en", "es", hints)
        durations.append((time.perf_counter() - started) * 1000)
        assert result.cached is True
    durations.sort()
    p95 = durations[int(len(durations) * 0.95) - 1]
    assert p95 < LatencyBudget().fast_path_ms, f"p95 {p95:.3f} ms"
    assert cached.hit_rate > 0.99


async def test_chain_falls_through_when_coverage_is_poor() -> None:
    class Weak:
        name = "weak"

        async def translate(self, text, source_lang, target_lang, hints=None):
            return Translation(text, text, source_lang, target_lang, self.name, coverage=0.1, confidence=0.2)

        async def warmup(self) -> None:
            return None

        async def close(self) -> None:
            return None

    class Strong:
        name = "strong"

        async def translate(self, text, source_lang, target_lang, hints=None):
            return Translation("fuerte", text, source_lang, target_lang, self.name, coverage=1.0, confidence=0.9)

        async def warmup(self) -> None:
            return None

        async def close(self) -> None:
            return None

    chain = ChainTranslator([Weak(), Strong()], min_coverage=0.8)
    result = await chain.translate("hola", "en", "es")
    assert result.text == "fuerte"
    assert result.engine == "strong"


async def test_chain_tolerates_engine_errors() -> None:
    class Broken:
        name = "broken"

        async def translate(self, *args, **kwargs):
            raise EngineError("down")

        async def warmup(self) -> None:
            return None

        async def close(self) -> None:
            return None

    class Healthy:
        name = "healthy"

        async def translate(self, text, source_lang, target_lang, hints=None):
            return Translation("ok", text, source_lang, target_lang, self.name)

        async def warmup(self) -> None:
            return None

        async def close(self) -> None:
            return None

    result = await ChainTranslator([Broken(), Healthy()]).translate("hi", "en", "es")
    assert result.text == "ok"


def test_token_helpers() -> None:
    assert _is_word("hello") is True
    assert _is_word("?") is False
    assert "coffee" in _stem_variants("coffees")
    assert "try" in _stem_variants("tries")
