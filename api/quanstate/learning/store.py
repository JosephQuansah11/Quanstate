"""Persistent per-profile translation memory.

A profile is a person (or a team).  Everything the device learns from uploaded
documents and YouTube transcripts lands here: phrase pairs, protected glossary
terms, STT hotwords and document provenance.  Reads go through an immutable,
versioned snapshot so translation never takes a lock on the audio hot path.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping

from .seed import seed_lexicon, seed_phrases
from .text import extract_phrase_pairs, extract_terms, normalize_phrase, split_sentences

PROFILE_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


class StoreError(ValueError):
    pass


@dataclass(frozen=True)
class MemorySnapshot:
    profile: str
    version: int
    phrases: Mapping[tuple[str, str, str], tuple[str, float, str]]
    glossary: Mapping[tuple[str, str, str], str]
    lexicon: Mapping[tuple[str, str, str], str]
    hotwords: Mapping[str, tuple[str, ...]]
    documents: tuple[dict[str, Any], ...]
    stats: Mapping[str, Any]

    def phrase(self, source_lang: str, target_lang: str, text: str) -> tuple[str, float, str] | None:
        return self.phrases.get((source_lang, target_lang, normalize_phrase(text)))

    def term(self, source_lang: str, target_lang: str, text: str) -> str | None:
        return self.glossary.get((source_lang, target_lang, normalize_phrase(text)))

    def word(self, source_lang: str, target_lang: str, text: str) -> str | None:
        return self.lexicon.get((source_lang, target_lang, normalize_phrase(text)))


def _empty_profile(profile: str) -> dict[str, Any]:
    return {
        "version": 1,
        "profile": profile,
        "phrases": [],
        "glossary": [],
        "hotwords": {},
        "documents": [],
        "updatedAt": time.time(),
    }


class MemoryStore:
    def __init__(self, data_dir: Path, seed: bool = True) -> None:
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._seed = seed
        self._lock = threading.RLock()
        self._profiles: dict[str, dict[str, Any]] = {}
        self._snapshots: dict[str, MemorySnapshot] = {}

    # ------------------------------------------------------------------ io
    def _path(self, profile: str) -> Path:
        if not PROFILE_RE.match(profile):
            raise StoreError("profile must match [a-zA-Z0-9_-]{1,64}")
        return self.data_dir / f"{profile}.json"

    def _load(self, profile: str) -> dict[str, Any]:
        cached = self._profiles.get(profile)
        if cached is not None:
            return cached
        path = self._path(profile)
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise StoreError(f"cannot read profile {profile!r}: {exc}") from exc
        else:
            data = _empty_profile(profile)
        data.setdefault("phrases", [])
        data.setdefault("glossary", [])
        data.setdefault("hotwords", {})
        data.setdefault("documents", [])
        data.setdefault("version", 1)
        self._profiles[profile] = data
        return data

    def _write(self, profile: str, data: dict[str, Any]) -> None:
        path = self._path(profile)
        data["updatedAt"] = time.time()
        data["version"] = int(data.get("version", 1)) + 1
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        tmp = path.with_suffix(".json.tmp")

    # -------------------------------------------------------------- writes
    def add_phrases(
        self,
        profile: str,
        source_lang: str,
        target_lang: str,
        pairs: Iterable[tuple[str, str]],
        origin: str = "document",
        weight: float = 1.5,
    ) -> int:
        added = 0
        with self._lock:
            data = self._load(profile)
            existing = {
                (item["sourceLang"], item["targetLang"], normalize_phrase(item["source"]))
                for item in data["phrases"]
            }
            for source, target in pairs:
                source, target = source.strip(), target.strip()
                if not source or not target or len(source) > 160 or len(target) > 160:
                    continue
                key = (source_lang, target_lang, normalize_phrase(source))
                if key in existing:
                    continue
                existing.add(key)
                data["phrases"].append(
                    {
                        "source": source,
                        "target": target,
                        "sourceLang": source_lang,
                        "targetLang": target_lang,
                        "origin": origin,
                        "weight": round(float(weight), 3),
                    }
                )
                added += 1
            if added:
                self._write(profile, data)
        return added

    def add_glossary(self, profile: str, source_lang: str, target_lang: str, terms: Mapping[str, str]) -> int:
        added = 0
        with self._lock:
            data = self._load(profile)
            existing = {
                (item["sourceLang"], item["targetLang"], normalize_phrase(item["source"]))
                for item in data["glossary"]
            }
            for source, target in terms.items():
                source, target = source.strip(), target.strip()
                if not source or not target:
                    continue
                key = (source_lang, target_lang, normalize_phrase(source))
                if key in existing:
                    continue
                existing.add(key)
                data["glossary"].append(
                    {"source": source, "target": target, "sourceLang": source_lang, "targetLang": target_lang}
                )
                added += 1
            if added:
                self._write(profile, data)
        return added

    def add_hotwords(self, profile: str, language: str, terms: Iterable[str], limit: int = 400) -> int:
        added = 0
        with self._lock:
            data = self._load(profile)
            bucket = data["hotwords"].setdefault(language, [])
            existing = {word.lower() for word in bucket}
            for term in terms:
                term = term.strip()
                if not term or len(term) > 48 or term.lower() in existing:
                    continue
                existing.add(term.lower())
                bucket.append(term)
                added += 1
            del bucket[limit:]
            if added:
                self._write(profile, data)
        return added

    def add_document(self, profile: str, record: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            data = self._load(profile)
            digest = record.get("digest") or hashlib.sha1(
                json.dumps(record, sort_keys=True, ensure_ascii=False).encode("utf-8")
            ).hexdigest()[:16]
            record = {**record, "id": record.get("id") or f"doc_{digest}", "digest": digest, "createdAt": time.time()}
            data["documents"] = [doc for doc in data["documents"] if doc.get("digest") != digest]
            data["documents"].insert(0, record)
            del data["documents"][50:]
            self._write(profile, data)
            return record

        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, path)
        self._snapshots.pop(profile, None)


    def learn_text(
        self,
        profile: str,
        source_lang: str,
        target_lang: str,
        text: str,
        *,
        origin: str,
        title: str = "",
        url: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Extract phrase pairs + terminology from raw material and persist it."""

        pairs = [(pair.source, pair.target) for pair in extract_phrase_pairs(text, limit=1000)]
        phrases_added = self.add_phrases(profile, source_lang, target_lang, pairs, origin=origin)
        reverse_added = self.add_phrases(
            profile, target_lang, source_lang, [(target, source) for source, target in pairs], origin=origin
        )

        glossary_terms: dict[str, str] = {}
        for source, target in pairs:
            if len(source.split()) <= 3:
                glossary_terms[source] = target
        terms = extract_terms(text, source_lang, limit=200)
        known_glossary = self.snapshot(profile).glossary
        for term, _score in terms:
            key = (source_lang, target_lang, normalize_phrase(term))
            if key in known_glossary:
                glossary_terms[term] = known_glossary[key]
        glossary_added = self.add_glossary(profile, source_lang, target_lang, glossary_terms)
        hotwords_added = self.add_hotwords(profile, source_lang, [term for term, _ in terms])
        hotwords_added += self.add_hotwords(profile, target_lang, list(glossary_terms.values()))

        sentences = split_sentences(text)
        record = {
            "kind": origin,
            "title": title or (sentences[0][:80] if sentences else "upload"),
            "url": url,
            "sourceLang": source_lang,
            "targetLang": target_lang,
            "characters": len(text),
            "sentences": len(sentences),
            "phrasesAdded": phrases_added + reverse_added,
            "glossaryAdded": glossary_added,
            "hotwordsAdded": hotwords_added,
            "metadata": metadata or {},
        }
        return self.add_document(profile, record)

    def reset(self, profile: str) -> None:
        with self._lock:
            self._profiles[profile] = _empty_profile(profile)
            self._write(profile, self._profiles[profile])
            self._snapshots.pop(profile, None)

    # --------------------------------------------------------------- reads
    def profiles(self) -> list[str]:
        return sorted(path.stem for path in self.data_dir.glob("*.json"))

    def documents(self, profile: str) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._load(profile)["documents"])

    def snapshot(self, profile: str = "default") -> MemorySnapshot:
        with self._lock:
            data = self._load(profile)
            current_version = int(data.get("version", 1))
            cached = self._snapshots.get(profile)
            if cached is not None and cached.version == current_version:
                return cached

            phrases: dict[tuple[str, str, str], tuple[str, float, str]] = {}
            if self._seed:
                for source_lang, target_lang, source, target in seed_phrases():
                    phrases[(source_lang, target_lang, normalize_phrase(source))] = (target, 1.0, "seed")
            for item in data["phrases"]:
                key = (item["sourceLang"], item["targetLang"], normalize_phrase(item["source"]))
                weight = float(item.get("weight", 1.5))
                previous = phrases.get(key)
                if previous is None or weight >= previous[1]:
                    phrases[key] = (item["target"], weight, item.get("origin", "document"))

            glossary: dict[tuple[str, str, str], str] = {}
            for item in data["glossary"]:
                key = (item["sourceLang"], item["targetLang"], normalize_phrase(item["source"]))
                glossary[key] = item["target"]

            lexicon: dict[tuple[str, str, str], str] = {}
            if self._seed:
                for (source_lang, target_lang), entries in seed_lexicon().items():
                    for source, target in entries.items():
                        lexicon[(source_lang, target_lang, normalize_phrase(source))] = target
            for item in data["phrases"]:
                source = normalize_phrase(item["source"])
                if len(source.split()) == 1:
                    lexicon[(item["sourceLang"], item["targetLang"], source)] = item["target"]

            hotwords = {language: tuple(words) for language, words in data["hotwords"].items()}
            stats = {
                "phrases": len(phrases),
                "learnedPhrases": len(data["phrases"]),
                "glossary": len(glossary),
                "documents": len(data["documents"]),
                "hotwords": sum(len(words) for words in hotwords.values()),
            }
            snapshot = MemorySnapshot(
                profile=profile,
                version=current_version,
                phrases=phrases,
                glossary=glossary,
                lexicon=lexicon,
                hotwords=hotwords,
                documents=tuple(data["documents"]),
                stats=stats,
            )
            self._snapshots[profile] = snapshot
            return snapshot
