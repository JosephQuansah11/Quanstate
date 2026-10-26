"""Text utilities for turning documents and captions into translation memory."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

SENTENCE_SPLIT = re.compile(r"(?<=[.!?।。？！])\s+|\n{2,}")
WORD_RE = re.compile(r"[\w'’\-]+", re.UNICODE)
PAIR_SEPARATORS = ("\t", " => ", " = ", " | ", "\u2192", "\u21d2")
CONTROL_CHARS = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f]")
MAX_PHRASE_CHARS = 160
STOPWORDS = {
    "en": {"the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "are", "was", "were", "it", "this", "that", "for", "with", "as", "at", "by", "be", "from", "we", "you", "i", "he", "she", "they", "but", "not", "have", "has", "do", "does"},
    "es": {"el", "la", "los", "las", "un", "una", "y", "o", "de", "a", "en", "es", "son", "que", "esto", "para", "con", "por", "del", "se", "no", "lo", "como", "pero", "su", "al"},
    "fr": {"le", "la", "les", "un", "une", "et", "ou", "de", "à", "en", "est", "sont", "que", "ce", "pour", "avec", "par", "des", "ne", "pas", "se", "il", "elle"},
    "de": {"der", "die", "das", "ein", "eine", "und", "oder", "von", "zu", "in", "ist", "sind", "dass", "dies", "für", "mit", "den", "dem", "nicht", "sich", "es"},
}


def clean_text(raw: str) -> str:
    return CONTROL_CHARS.sub(" ", raw.replace("\r\n", "\n").replace("\r", "\n")).strip()


def split_sentences(text: str) -> list[str]:
    cleaned = clean_text(text)
    parts = [part.strip() for part in SENTENCE_SPLIT.split(cleaned) if part and part.strip()]
    sentences: list[str] = []
    for part in parts:
        if len(part) <= MAX_PHRASE_CHARS:
            sentences.append(part)
            continue
        # Long paragraph: fall back to comma/clause boundaries, then hard wraps.
        for clause in re.split(r"(?<=[,;:])\s+", part):
            clause = clause.strip()
            while len(clause) > MAX_PHRASE_CHARS:
                sentences.append(clause[:MAX_PHRASE_CHARS].strip())
                clause = clause[MAX_PHRASE_CHARS:].strip()
            if clause:
                sentences.append(clause)
    return sentences


def normalize_phrase(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def words(text: str) -> list[str]:
    return WORD_RE.findall(text)


def _looks_bilingual(line: str) -> tuple[str, str] | None:
    for separator in PAIR_SEPARATORS:
        if separator in line:
            left, _, right = line.partition(separator)
            left, right = left.strip(), right.strip()
            if 1 <= len(left) <= MAX_PHRASE_CHARS and 1 <= len(right) <= MAX_PHRASE_CHARS and left and right:
                return left, right
    return None


@dataclass(frozen=True)
class ExtractedPair:
    source: str
    target: str


def extract_phrase_pairs(text: str, limit: int = 500) -> list[ExtractedPair]:
    """Pull explicit ``source <sep> target`` pairs out of a document.

    Supports the formats teams actually keep glossaries in: TSV, ``a = b``,
    ``a | b`` and ``a => b``.  This is what turns an upload into an immediate
    translation-quality jump for the terms that matter.
    """

    pairs: list[ExtractedPair] = []
    seen: set[str] = set()
    for line in clean_text(text).split("\n"):
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        found = _looks_bilingual(line)
        if not found:
            continue
        source, target = found
        key = normalize_phrase(source)
        if key in seen:
            continue
        seen.add(key)
        pairs.append(ExtractedPair(source=source, target=target))
        if len(pairs) >= limit:
            break
    return pairs



def extract_terms(text: str, language: str = "en", limit: int = 200) -> list[tuple[str, float]]:
    """Rank domain terminology from monolingual material (captions, articles).

    Score mixes frequency, capitalisation, length and digits/camelCase -- the
    signals that distinguish "Quanstate", "WebSocket" or "NLLB-200" from ordinary
    prose.  The terms feed STT hotwords, so video
    uploads sharpen recognition and speech as well as translation.
    """

    stop = STOPWORDS.get(language.split("-")[0], set())
    scores: dict[str, float] = {}
    display: dict[str, str] = {}
    tokens = [token for token in words(text) if 2 <= len(token) <= 40]
    for index, token in enumerate(tokens):
        lower = token.lower()
        if lower in stop or lower.isdigit():
            continue
        score = 1.0
        if token[:1].isupper() and index > 0:
            score += 1.5
        if any(char.isdigit() for char in token):
            score += 1.2
        if any(char.isupper() for char in token[1:]):
            score += 1.5
        if "-" in token or "_" in token:
            score += 0.4
        if len(token) > 9:
            score += 0.3
        scores[lower] = scores.get(lower, 0.0) + score
        display.setdefault(lower, token)

    # Multiword proper-noun phrases ("United Nations", "Quanstate Labs").
    for size in (3, 2):
        for start in range(len(tokens) - size + 1):
            chunk = tokens[start : start + size]
            if not all(word[:1].isupper() for word in chunk if word):
                continue
            phrase = " ".join(chunk)
            key = phrase.lower()
            if key in scores or len(phrase) > 40:
                continue
            scores[key] = 3.0 + size
            display[key] = phrase

    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:limit]
    return [(display[key], round(score, 3)) for key, score in ranked]


def extract_srt_cues(text: str) -> list[str]:
    """Return the spoken lines of an SRT/VTT transcript.

    Strip cue numbers, timing lines and VTT headers; keep subtitle text only.
    """

    cues: list[str] = []
    for line in clean_text(text).split("\n"):
        stripped = line.strip()
        if not stripped or stripped.isdigit() or stripped == "WEBVTT":
            continue
        if "-->" in stripped or stripped.startswith(("NOTE ", "STYLE", "REGION")):
            continue
        cues.append(stripped)
    return cues


def chunk_sentences(sentences: Iterable[str], max_chars: int = 700) -> list[str]:
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if len(sentence) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(sentence[:max_chars])
            continue
        candidate = f"{current} {sentence}".strip()
        if len(candidate) > max_chars:
            chunks.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks
