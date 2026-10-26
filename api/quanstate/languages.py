"""Language catalogue shared by the API and every client platform.

The canonical data lives in ``quanstate/data/languages.json``.  The TypeScript
``@quanstate/services`` package ships the same catalogue and a parity test keeps
both sides honest.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import PACKAGE_DIR

DATA_FILE = PACKAGE_DIR / "data" / "languages.json"


class LanguageError(ValueError):
    """Raised when a language code is unknown or a pair is unsupported."""


@dataclass(frozen=True)
class Language:
    code: str
    name: str
    native_name: str
    bcp47: str
    direction: str
    whisper: str
    nllb: str
    piper: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "name": self.name,
            "nativeName": self.native_name,
            "bcp47": self.bcp47,
            "direction": self.direction,
            "whisper": self.whisper,
            "piper": self.piper,
        }


@lru_cache(maxsize=1)
def _catalogue() -> dict[str, Any]:
    with DATA_FILE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def languages() -> dict[str, Language]:
    items: dict[str, Language] = {}
    for raw in _catalogue()["languages"]:
        language = Language(
            code=raw["code"],
            name=raw["name"],
            native_name=raw["nativeName"],
            bcp47=raw["bcp47"],
            direction=raw["direction"],
            whisper=raw["whisper"],
            nllb=raw["nllb"],
            piper=raw.get("piper"),
        )
        items[language.code] = language
    return items


def defaults() -> dict[str, Any]:
    return dict(_catalogue()["defaults"])


def get_language(code: str) -> Language:
    key = (code or "").strip().lower().replace("_", "-")
    table = languages()
    if key in table:
        return table[key]
    base = key.split("-")[0]
    if base in table:
        return table[base]
    raise LanguageError(f"unsupported language: {code!r}")


def require_pair(source: str, target: str) -> tuple[Language, Language]:
    source_language = get_language(source)
    target_language = get_language(target)
    if source_language.code == target_language.code:
        raise LanguageError("source and target languages must differ")
    return source_language, target_language


def public_catalogue() -> dict[str, Any]:
    return {
        "version": _catalogue()["version"],
        "defaults": defaults(),
        "languages": [language.as_dict() for language in languages().values()],
    }
