"""PCM helpers, streaming VAD and WAV packaging.

Everything here runs on numpy views so a 20 ms frame costs microseconds: the
audio path must not threaten the 5 ms hot-path budget.
"""

from __future__ import annotations

import io
import wave
from collections import deque
from dataclasses import dataclass
from typing import Iterator

import numpy as np

INT16_SCALE = 1.0 / 32768.0


def pcm16le_to_float32(data: bytes) -> np.ndarray:
    """Decode little-endian PCM16 bytes into float32 samples in [-1, 1]."""

    if len(data) % 2:
        data = data[:-1]
    if not data:
        return np.zeros(0, dtype=np.float32)
    samples = np.frombuffer(data, dtype="<i2")
    return (samples.astype(np.float32) * INT16_SCALE).copy()


def float32_to_pcm16le(samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def resample(samples: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    """Fast linear/box resampling.

    Integer decimation (48 kHz -> 16 kHz, the common browser case) uses a box
    filter, which is both cheaper and less aliased than naive decimation.
    """

    if source_rate == target_rate or samples.size == 0:
        return samples
    if source_rate % target_rate == 0:
        factor = source_rate // target_rate
        usable = (samples.size // factor) * factor
        if usable == 0:
            return np.zeros(0, dtype=np.float32)
        return samples[:usable].reshape(-1, factor).mean(axis=1).astype(np.float32)
    duration = samples.size / float(source_rate)
    target_count = max(1, int(round(duration * target_rate)))
    source_positions = np.arange(samples.size, dtype=np.float64) / float(source_rate)
    target_positions = np.arange(target_count, dtype=np.float64) / float(target_rate)
    return np.interp(target_positions, source_positions, samples).astype(np.float32)


def rms(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))


def peak(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0
    return float(np.max(np.abs(samples)))


def frame_slice(samples: np.ndarray, frame_samples: int) -> Iterator[np.ndarray]:
    for start in range(0, samples.size, frame_samples):
        chunk = samples[start : start + frame_samples]
        if chunk.size:
            yield chunk


def wav_bytes(samples: np.ndarray, sample_rate: int = 16_000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(float32_to_pcm16le(samples))
    return buffer.getvalue()
@dataclass
class Utterance:
    samples: np.ndarray
    start_ms: float
    end_ms: float
    speech_ms: float

    @property
    def duration_ms(self) -> float:
        return self.end_ms - self.start_ms


class StreamingVad:
    """Energy VAD with adaptive noise floor and pre-roll.

    The detector is intentionally deterministic so it can be unit tested with
    synthesised tones and near-silence.  It emits one ``Utterance`` per spoken
    region, which is the unit the STT/translation pipeline prices its latency in.
    """

    def __init__(
        self,
        sample_rate: int = 16_000,
        frame_ms: int = 20,
        threshold_ratio: float = 3.2,
        min_energy: float = 0.004,
        min_speech_ms: float = 120.0,
        end_silence_ms: float = 300.0,
        pre_roll_ms: float = 200.0,
        max_utterance_ms: float = 20_000.0,
    ) -> None:
        self.sample_rate = sample_rate
        self.frame_ms = frame_ms
        self.threshold_ratio = threshold_ratio
        self.min_energy = min_energy
        self.min_speech_ms = min_speech_ms
        self.end_silence_ms = end_silence_ms
        self.pre_roll_ms = pre_roll_ms
        self.max_utterance_ms = max_utterance_ms

        self._noise_floor = 0.0015
        self._speaking = False
        self._silence_ms = 0.0
        self._speech_ms = 0.0
        self._utterance_ms = 0.0
        self._collected: list[np.ndarray] = []
        self._pre_roll: deque[np.ndarray] = deque(maxlen=max(1, int(pre_roll_ms // frame_ms)))
        self._cursor_ms = 0.0
        self._utterance_start_ms = 0.0

    @property
    def speaking(self) -> bool:
        return self._speaking

    @property
    def noise_floor(self) -> float:
        return self._noise_floor

    def _threshold(self) -> float:
        return max(self.min_energy, self._noise_floor * self.threshold_ratio)

    def push(self, frame: np.ndarray) -> list[Utterance]:
        emitted: list[Utterance] = []
        energy = rms(frame)
        threshold = self._threshold()
        voiced = energy >= threshold

        if not self._speaking:
            self._noise_floor = 0.98 * self._noise_floor + 0.02 * min(energy, 0.05)

        if voiced:
            self._speech_ms += self.frame_ms
            self._silence_ms = 0.0
            if not self._speaking:
                self._speaking = True
                self._utterance_start_ms = self._cursor_ms - (len(self._pre_roll) * self.frame_ms if self._pre_roll else 0.0)
                self._collected = list(self._pre_roll)
                self._pre_roll.clear()
                self._utterance_ms = len(self._collected) * self.frame_ms
            self._collected.append(frame)
            self._utterance_ms += self.frame_ms
        elif self._speaking:
            self._collected.append(frame)
            self._utterance_ms += self.frame_ms
            self._silence_ms += self.frame_ms
            if self._silence_ms >= self.end_silence_ms:
                utterance = self._close()
                if utterance is not None:
                    emitted.append(utterance)
        else:
            self._pre_roll.append(frame)

        if self._speaking and self._utterance_ms >= self.max_utterance_ms:
            utterance = self._close()
            if utterance is not None:
                emitted.append(utterance)

        self._cursor_ms += self.frame_ms
        return emitted

    def current_audio(self) -> np.ndarray:
        """Snapshot of the in-progress utterance (used for partial hypotheses)."""

        if not self._collected:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(self._collected)

    def flush(self) -> Utterance | None:
        if self._speaking:
            return self._close()
        self._pre_roll.clear()
        return None

    def _close(self) -> Utterance | None:
        samples = np.concatenate(self._collected) if self._collected else np.zeros(0, dtype=np.float32)
        start_ms = self._utterance_start_ms
        end_ms = self._cursor_ms + self.frame_ms
        speech_ms = self._speech_ms
        self._speaking = False
        self._collected = []
        self._silence_ms = 0.0
        self._speech_ms = 0.0
        self._utterance_ms = 0.0
        self._pre_roll.clear()
        if speech_ms < self.min_speech_ms:
            return None
        return Utterance(samples=samples, start_ms=start_ms, end_ms=end_ms, speech_ms=speech_ms)

