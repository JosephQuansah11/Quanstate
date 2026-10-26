"""Optional real-model STT check.

Run with a local CTranslate2 Whisper model and any 16 kHz WAV:

    QUANSTATE_WHISPER_MODEL=/models/faster-whisper-tiny \\
    QUANSTATE_TEST_AUDIO=/path/sample.wav python -m pytest tests/test_local_stt_optional.py -q

Skipped by default so CI stays lean and offline.
"""

from __future__ import annotations

import os
import time
import wave
from pathlib import Path

import pytest

from quanstate.audio import pcm16le_to_float32
from quanstate.engines.transcriber import FasterWhisperTranscriber

MODEL = os.environ.get("QUANSTATE_WHISPER_MODEL", "")
AUDIO = os.environ.get("QUANSTATE_TEST_AUDIO", "")

pytestmark = pytest.mark.skipif(
    not MODEL or not AUDIO or not Path(MODEL).exists() or not Path(AUDIO).exists(),
    reason="set QUANSTATE_WHISPER_MODEL and QUANSTATE_TEST_AUDIO to run real STT",
)


async def test_real_whisper_transcription() -> None:
    with wave.open(AUDIO, "rb") as handle:
        sample_rate = handle.getframerate()
        samples = pcm16le_to_float32(handle.readframes(handle.getnframes()))

    transcriber = FasterWhisperTranscriber(MODEL, "int8")
    started = time.perf_counter()
    result = await transcriber.transcribe(samples, sample_rate, "en")
    elapsed_ms = (time.perf_counter() - started) * 1000
    await transcriber.close()

    assert result.text.strip(), "expected a transcript"
    assert result.confidence > 0.3
    assert elapsed_ms < 60_000
    print(f"\nREAL STT {elapsed_ms:.0f} ms -> {result.text!r}")
