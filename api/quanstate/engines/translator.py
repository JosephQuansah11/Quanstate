"""Translation engines.

The shipped default is the offline memory engine: exact phrase hits return in
microseconds, which is how the 5 ms hot-path target is met without a GPU.  It is
wrapped by a versioned LRU so repeated utterances (announcements, menus,
conference Q&A) are constant-time.  Network/neural engines are opt-in and sit
behind the same interface, so clients never change.
"""

from __future__ import annotations

import asyncio
import re
import time
from collections import OrderedDict
from dataclasses import replace
from typing import Any, Sequence

from ..languages import get_language
from ..learning.store import MemorySnapshot, MemoryStore
from ..config import http_verify_option
from .base import EngineError, Translation, TranslationHints, Translator

TOKEN_RE = re.compile(r"[\w'’\-]+|[^\w\s]", re.UNICODE)
CJK_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]")
OPENERS = {"(", "[", "{", "¡", "¿", "«", "“", "‘"}
CLOSERS = {".", ",", "!", "?", ";", ":", ")", "]", "}", "»", "”", "’", "%"}
MAX_PHRASE_TOKENS = 6
WORD_SUFFIXES = ("ing", "ed", "es", "s")


def _is_word(token: str) -> bool:
    return bool(token) and (token[0].isalnum() or token[0] == "_" or CJK_RE.match(token[0]) is not None)


def _stem_variants(word: str) -> list[str]:
    variants: list[str] = []
    lower = word.lower()
    for suffix in WORD_SUFFIXES:
        if lower.endswith(suffix) and len(lower) - len(suffix) >= 3:
            variants.append(lower[: -len(suffix)])
    if lower.endswith("ies") and len(lower) > 4:
        variants.append(lower[:-3] + "y")
    return variants


def _join_pieces(pieces: list[tuple[str, bool]]) -> str:
    output = ""
    for token, is_word in pieces:
        if is_word:
            cjk_adjacent = bool(output and CJK_RE.search(output[-1])) or bool(token and CJK_RE.search(token[0]))
            if output and not cjk_adjacent and not output.endswith((" ", "¿", "¡", "(", "[", "{", "«", "“", "‘")):
                output += " "
            output += token
        elif token in OPENERS:
            if output and not output.endswith(" "):
                output += " "
            output += token
        elif token in CLOSERS:
            output = output.rstrip() + token
        else:
            output += token
    return re.sub(r"[ \t]{2,}", " ", output).strip()


class MemoryTranslator:
    """Glossary + phrase-memory translator with word-level lexicon fallback."""

    name = "memory"

    def __init__(self, store: MemoryStore) -> None:
        self.store = store

    def _snapshot(self, hints: TranslationHints | None) -> MemorySnapshot:
        return self.store.snapshot((hints.profile if hints else "default") or "default")

    async def translate(
        self, text: str, source_lang: str, target_lang: str, hints: TranslationHints | None = None
    ) -> Translation:
        started = time.perf_counter()
        snapshot = self._snapshot(hints)
        clean = text.strip()
        if not clean:
            return Translation("", clean, source_lang, target_lang, self.name, latency_ms=0.0)

        core = clean.rstrip("?!.,;: ")
        trailing = clean[len(core) :]

        exact = snapshot.phrase(source_lang, target_lang, core)
        if exact is not None:
            target_text, _weight, origin = exact
            protected = snapshot.term(source_lang, target_lang, core) is not None
            if trailing and not target_text.endswith(trailing[0]):
                target_text += trailing
            return Translation(
                text=target_text,
                source_text=clean,
                source_lang=source_lang,
                target_lang=target_lang,
                engine=self.name,
                confidence=1.0,
                coverage=1.0,
                glossary_hits=(core,) if protected else (),
                latency_ms=(time.perf_counter() - started) * 1000.0,
                detail={"match": f"phrase:{origin}"},
            )

        if CJK_RE.search(core):
            pieces, known, total, hits = self._translate_cjk(core, snapshot, source_lang, target_lang)
        else:
            pieces, known, total, hits = self._translate_tokens(core, snapshot, source_lang, target_lang)

        rendered = _join_pieces(pieces)
        if trailing and rendered and not rendered.endswith(trailing[0]):
            rendered += trailing
        if core[:1].isupper() and rendered:
            rendered = rendered[0].upper() + rendered[1:]
        elif core[:1].isupper():
            rendered = core

        coverage = (known / total) if total else 1.0
        confidence = 1.0 if coverage >= 1.0 else round(0.3 + 0.69 * coverage, 3)
        return Translation(
            text=rendered,
            source_text=clean,
            source_lang=source_lang,
            target_lang=target_lang,
            engine=self.name,
            confidence=confidence,
            coverage=round(coverage, 3),
            glossary_hits=tuple(hits),
            latency_ms=(time.perf_counter() - started) * 1000.0,
            detail={"knownWords": known, "words": total},
        )

    def _translate_tokens(
        self, text: str, snapshot: MemorySnapshot, source_lang: str, target_lang: str
    ) -> tuple[list[tuple[str, bool]], int, int, list[str]]:
        tokens = TOKEN_RE.findall(text)
        pieces: list[tuple[str, bool]] = []
        hits: list[str] = []
        known = 0
        total = 0
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if not _is_word(token):
                pieces.append((token, False))
                index += 1
                continue

            total += 1
            matched: tuple[str, int, bool] | None = None
            for length in range(min(MAX_PHRASE_TOKENS, len(tokens) - index), 0, -1):
                chunk = tokens[index : index + length]
                if not all(_is_word(item) for item in chunk):
                    continue
                candidate = " ".join(chunk)
                term = snapshot.term(source_lang, target_lang, candidate)
                if term is not None:
                    matched = (term, length, True)
                    break
                phrase = snapshot.phrase(source_lang, target_lang, candidate)
                if phrase is not None:
                    matched = (phrase[0], length, False)
                    break

            if matched is not None:
                rendered, length, is_glossary = matched
                pieces.append((rendered, True))
                known += length
                total += length - 1
                if is_glossary:
                    hits.append(" ".join(tokens[index : index + length]))
                index += length
                continue

            term = snapshot.term(source_lang, target_lang, token)
            if term is not None:
                pieces.append((term, True))
                known += 1
                hits.append(token)
            else:
                word = snapshot.word(source_lang, target_lang, token)
                if word is None:
                    for variant in _stem_variants(token):
                        word = snapshot.word(source_lang, target_lang, variant)
                        if word is not None:
                            break
                if word is not None:
                    pieces.append((word, True))
                    known += 1
                else:
                    pieces.append((token, True))
            index += 1
        return pieces, known, total, hits

    def _translate_cjk(
        self, text: str, snapshot: MemorySnapshot, source_lang: str, target_lang: str
    ) -> tuple[list[tuple[str, bool]], int, int, list[str]]:
        pieces: list[tuple[str, bool]] = []
        hits: list[str] = []
        known = 0
        total = 0
        index = 0
        while index < len(text):
            char = text[index]
            if not _is_word(char):
                pieces.append((char, False))
                index += 1
                continue
            total += 1
            matched: tuple[str, int, bool] | None = None
            for length in range(min(8, len(text) - index), 0, -1):
                chunk = text[index : index + length]
                if not all(_is_word(item) for item in chunk):
                    continue
                term = snapshot.term(source_lang, target_lang, chunk)
                if term is not None:
                    matched = (term, length, True)
                    break
                phrase = snapshot.phrase(source_lang, target_lang, chunk)
                if phrase is not None:
                    matched = (phrase[0], length, False)
                    break
                word = snapshot.word(source_lang, target_lang, chunk)
                if word is not None:
                    matched = (word, length, False)
                    break
            if matched is None:
                pieces.append((char, True))
            else:
                rendered, length, is_glossary = matched
                pieces.append((rendered, True))
                known += length
                total += length - 1
                if is_glossary:
                    hits.append(text[index : index + length])
            index += 1
        return pieces, known, total, hits


class CachedTranslator:
    """Versioned LRU in front of any engine.

    Keying on ``memory_version`` means uploads invalidate stale translations
    instantly, while repeated announcements stay in the sub-millisecond zone.
    """

    def __init__(self, inner: Translator, max_entries: int = 4096) -> None:
        self.inner = inner
        self.name = f"{inner.name}+cache"
        self._cache: OrderedDict[tuple[int, str, str, str], Translation] = OrderedDict()
        self._max_entries = max(1, max_entries)
        self.hits = 0
        self.misses = 0

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return (self.hits / total) if total else 0.0

    def _memory_version(self, hints: TranslationHints | None) -> int:
        if hints is not None:
            return hints.memory_version
        store = getattr(self.inner, "store", None)
        if store is not None:
            return int(store.snapshot("default").version)
        return 0

    async def translate(
        self, text: str, source_lang: str, target_lang: str, hints: TranslationHints | None = None
    ) -> Translation:
        started = time.perf_counter()
        key = (self._memory_version(hints), source_lang, target_lang, text)
        cached = self._cache.get(key)
        if cached is not None:
            self._cache.move_to_end(key)
            self.hits += 1
            return replace(
                cached,
                cached=True,
                engine=f"{cached.engine}:cache",
                latency_ms=(time.perf_counter() - started) * 1000.0,
            )
        self.misses += 1
        result = await self.inner.translate(text, source_lang, target_lang, hints)
        self._cache[key] = result
        if len(self._cache) > self._max_entries:
            self._cache.popitem(last=False)
        return result

    def invalidate(self) -> None:
        self._cache.clear()

    async def warmup(self) -> None:
        await self.inner.warmup()

    async def close(self) -> None:
        await self.inner.close()


class ChainTranslator:
    """Memory first, heavier engines only when coverage demands it."""

    def __init__(self, engines: Sequence[Translator], min_coverage: float = 0.85) -> None:
        if not engines:
            raise EngineError("ChainTranslator needs at least one engine")
        self.engines = list(engines)
        self.min_coverage = min_coverage
        self.name = "+".join(engine.name for engine in self.engines)

    async def translate(
        self, text: str, source_lang: str, target_lang: str, hints: TranslationHints | None = None
    ) -> Translation:
        best: Translation | None = None
        for engine in self.engines:
            try:
                result = await engine.translate(text, source_lang, target_lang, hints)
            except EngineError:
                continue
            if best is None:
                best = result
            else:
                current = (len(result.glossary_hits), result.coverage, result.confidence)
                previous = (len(best.glossary_hits), best.coverage, best.confidence)
                if current > previous:
                    best = result
            if result.glossary_hits or result.coverage >= self.min_coverage:
                break
        if best is None:
            raise EngineError("no translation engine could serve the request")
        return best

    async def warmup(self) -> None:
        for engine in self.engines:
            await engine.warmup()

    async def close(self) -> None:
        for engine in self.engines:
            await engine.close()

class HttpTranslator:
    """LibreTranslate-compatible HTTP provider for open-domain coverage."""

    name = "http"

    def __init__(self, endpoint: str, timeout: float = 4.0) -> None:
        if not endpoint:
            raise EngineError("HttpTranslator requires an endpoint URL")
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout
        self._client: Any = None
        self._lock = asyncio.Lock()

    async def _get_client(self) -> Any:
        if self._client is None:
            async with self._lock:
                if self._client is None:
                    try:
                        import httpx
                    except ImportError as exc:  # pragma: no cover
                        raise EngineError("HttpTranslator needs httpx") from exc
                    self._client = httpx.AsyncClient(timeout=self.timeout, verify=http_verify_option())
        return self._client

    async def translate(
        self, text: str, source_lang: str, target_lang: str, hints: TranslationHints | None = None
    ) -> Translation:
        started = time.perf_counter()
        client = await self._get_client()
        payload = {"q": text, "source": source_lang, "target": target_lang, "format": "text"}
        try:
            response = await client.post(f"{self.endpoint}/translate", json=payload)
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            raise EngineError(f"translation provider failed: {exc}") from exc
        translated = data.get("translatedText") if isinstance(data, dict) else None
        if not isinstance(translated, str) or not translated:
            raise EngineError("translation provider returned an empty result")
        return Translation(
            text=translated,
            source_text=text,
            source_lang=source_lang,
            target_lang=target_lang,
            engine=self.name,
            confidence=0.9,
            coverage=1.0,
            latency_ms=(time.perf_counter() - started) * 1000.0,
        )

    async def warmup(self) -> None:
        return None

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


class NllbTranslator:
    """Optional NLLB-200 adapter (CPU or GPU) behind the same contract."""

    name = "nllb"

    def __init__(self, model_name: str = "facebook/nllb-200-distilled-600M", device: str = "cpu") -> None:
        self.model_name = model_name
        self.device = device
        self._tokenizer: Any = None
        self._model: Any = None
        self._torch: Any = None
        self._lock = asyncio.Lock()

    async def _ensure_model(self) -> None:
        if self._model is not None:
            return
        async with self._lock:
            if self._model is not None:
                return
            try:
                import torch
                from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
            except ImportError as exc:  # pragma: no cover - optional extra
                raise EngineError("NLLB needs 'torch' and 'transformers' (pip install 'quanstate[nllb]')") from exc

            def load() -> tuple[Any, Any]:
                tokenizer = AutoTokenizer.from_pretrained(self.model_name)
                model = AutoModelForSeq2SeqLM.from_pretrained(self.model_name)
                model.eval()
                return tokenizer, model

            self._tokenizer, self._model = await asyncio.to_thread(load)
            self._torch = torch

    async def translate(
        self, text: str, source_lang: str, target_lang: str, hints: TranslationHints | None = None
    ) -> Translation:
        started = time.perf_counter()
        await self._ensure_model()
        source_code = get_language(source_lang).nllb
        target_code = get_language(target_lang).nllb
        tokenizer, model, torch = self._tokenizer, self._model, self._torch

        def run() -> str:
            tokenizer.src_lang = source_code
            encoded = tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
            with torch.no_grad():
                generated = model.generate(
                    **encoded,
                    forced_bos_token_id=tokenizer.convert_tokens_to_ids(target_code),
                    max_new_tokens=256,
                    num_beams=1,
                )
            return tokenizer.batch_decode(generated, skip_special_tokens=True)[0]

        translated = await asyncio.to_thread(run)
        return Translation(
            text=translated,
            source_text=text,
            source_lang=source_lang,
            target_lang=target_lang,
            engine=self.name,
            confidence=0.92,
            coverage=1.0,
            latency_ms=(time.perf_counter() - started) * 1000.0,
        )

    async def warmup(self) -> None:
        await self._ensure_model()

    async def close(self) -> None:
        self._model = None
        self._tokenizer = None
