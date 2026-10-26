"""Text-to-speech engines.

The browser and React Native clients speak with the platform voice by default
(``ttsMode=client``), which has effectively zero network latency.  When a server
voice is wanted the API can stream PCM from Piper, or fall back to the bundled
formant synthesiser -- an intelligible, dependency-free voice used by tests and
offline demos.
"""

from __future__ import annotations

import asyncio
import math
import re
from pathlib import Path
from typing import AsyncIterator

import numpy as np

from ..languages import get_language
from .base import EngineError

VOWEL_FORMANTS: dict[str, tuple[float, float]] = {
    "a": (730.0, 1090.0),
    "e": (530.0, 1840.0),
    "i": (270.0, 2290.0),
    "o": (570.0, 840.0),
    "u": (300.0, 870.0),
    "y": (300.0, 1700.0),
}
VOWELS = set(VOWEL_FORMANTS)
SYLLABLE_SECONDS = 0.115
CONSONANT_SECONDS = 0.018
WORD_GAP_SECONDS = 0.045
MAX_CHARACTERS = 600


def _syllables(word: str) -> list[str]:
    groups = re.findall(r"[aeiouy]+", word.lower())
    if not groups:
        return ["a"]
    return groups


class ToneSynthesizer:
    """Formant-based voice: real audio out of the box, no model download."""

    name = "tone"

    def __init__(self, sample_rate: int = 16_000, frame_ms: int = 20) -> None:
        self.sample_rate = sample_rate
        self.frame_samples = int(sample_rate * frame_ms / 1000)

    def _word(self, word: str, pitch: float) -> np.ndarray:
        chunks: list[np.ndarray] = []
        syllables = _syllables(word)
        for index, syllable in enumerate(syllables):
            count = max(1, len(syllable))
            duration = SYLLABLE_SECONDS + 0.012 * count
            total = int(self.sample_rate * duration)
            time_axis = np.arange(total, dtype=np.float32) / self.sample_rate
            formants = VOWEL_FORMANTS.get(syllable[0], (500.0, 1500.0))
            envelope = np.minimum(
                1.0, np.minimum(time_axis / 0.02, (duration - time_axis) / 0.03).clip(min=0.0)
            )
            signal = np.zeros(total, dtype=np.float32)
            for harmonic in range(1, 9):
                amplitude = 1.0 / harmonic
                frequency = pitch * harmonic * (1.0 + 0.02 * index)
                signal += amplitude * np.sin(2.0 * np.pi * frequency * time_axis)
            carrier = np.sin(2.0 * np.pi * formants[0] * time_axis) + 0.5 * np.sin(
                2.0 * np.pi * formants[1] * time_axis
            )
            signal = (0.55 * signal + 0.45 * signal * carrier) * envelope
            chunks.append((0.22 * signal).astype(np.float32))

        if word[:1] and word[:1].lower() not in VOWELS:
            noise_length = int(self.sample_rate * CONSONANT_SECONDS)
            noise = np.random.default_rng(abs(hash(word)) % (2**32)).normal(0.0, 0.05, noise_length).astype(np.float32)
            noise *= np.linspace(1.0, 0.0, noise_length, dtype=np.float32)
            chunks.insert(0, noise)

        chunks.append(np.zeros(int(self.sample_rate * WORD_GAP_SECONDS), dtype=np.float32))
        return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)

    def render(self, text: str, language: str = "en") -> np.ndarray:
        pitch = {"es": 150.0, "fr": 160.0, "de": 125.0, "it": 155.0, "ja": 175.0, "zh": 170.0}.get(
            language.split("-")[0], 140.0
        )
        words = [word for word in re.findall(r"[\w'’\-]+|[,.!?;:]", text[:MAX_CHARACTERS]) if word]
        if not words:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate([self._word(word, pitch) for word in words])

    async def stream(self, text: str, language: str) -> AsyncIterator[np.ndarray]:
        audio = self.render(text, language)
        for start in range(0, audio.size, self.frame_samples):
            frame = audio[start : start + self.frame_samples]
            if frame.size:
                yield frame
            await asyncio.sleep(0)



class PiperSynthesizer:
    """Streams PCM from the local ``piper`` binary and a downloaded voice."""

    name = "piper"

    def __init__(self, voice_dir: str, sample_rate: int = 22_050, chunk_bytes: int = 4096) -> None:
        if not voice_dir:
            raise EngineError("Piper needs QUANSTATE_PIPER_VOICES pointing at the voice directory")
        self.voice_dir = Path(voice_dir)
        self.sample_rate = sample_rate
        self.chunk_bytes = chunk_bytes

    def voice_path(self, language: str) -> Path:
        voice = get_language(language).piper
        if not voice:
            raise EngineError(f"no Piper voice is published for language {language!r}")
        for candidate in (self.voice_dir / f"{voice}.onnx", self.voice_dir / f"{voice}.onnx".lower()):
            if candidate.exists():
                return candidate
        raise EngineError(f"Piper voice {voice!r} not found in {self.voice_dir}")

    async def stream(self, text: str, language: str) -> AsyncIterator[np.ndarray]:
        model = self.voice_path(language)
        try:
            process = await asyncio.create_subprocess_exec(
                "piper",
                "--model",
                str(model),
                "--output-raw",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except FileNotFoundError as exc:
            raise EngineError("the 'piper' binary is not installed") from exc

        assert process.stdin is not None and process.stdout is not None
        process.stdin.write(text[:MAX_CHARACTERS].encode("utf-8"))
        await process.stdin.drain()
        process.stdin.close()

        remainder = b""
        while True:
            chunk = await process.stdout.read(self.chunk_bytes)
            if not chunk:
                break
            chunk = remainder + chunk
            usable = len(chunk) - (len(chunk) % 2)
            remainder = chunk[usable:]
            if usable:
                samples = np.frombuffer(chunk[:usable], dtype="<i2").astype(np.float32) / 32768.0
                yield samples
        await process.wait()


def silence(seconds: float, sample_rate: int = 16_000) -> np.ndarray:
    return np.zeros(max(1, int(seconds * sample_rate)), dtype=np.float32)


def rms_of(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0
    return float(math.sqrt(float(np.mean(np.square(samples, dtype=np.float64)))))
