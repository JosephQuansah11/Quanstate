from __future__ import annotations

import io
import wave

import numpy as np

from quanstate.audio import (
    StreamingVad,
    float32_to_pcm16le,
    pcm16le_to_float32,
    resample,
    rms,
    wav_bytes,
)
from tests.conftest import pcm_bytes, silence, tone


def test_pcm16_roundtrip_is_within_quantisation_error() -> None:
    samples = tone(0.05, amplitude=0.8)
    restored = pcm16le_to_float32(float32_to_pcm16le(samples))
    assert restored.shape == samples.shape
    assert np.max(np.abs(restored - samples)) < 1e-3


def test_pcm_decoder_handles_odd_lengths_and_empty_frames() -> None:
    assert pcm16le_to_float32(b"").size == 0
    assert pcm16le_to_float32(b"\x00").size == 0
    assert pcm16le_to_float32(b"\x00\x01\x02").size == 1


def test_resample_box_filter_preserves_energy() -> None:
    source = tone(0.1, sample_rate=48_000)
    output = resample(source, 48_000, 16_000)
    assert output.size == 1_600
    assert abs(rms(output) - rms(source)) < 0.02


def test_resample_interpolates_arbitrary_rates() -> None:
    source = tone(0.05, sample_rate=44_100)
    output = resample(source, 44_100, 16_000)
    assert output.size == 800
    assert rms(output) > 0.1


def test_wav_container_is_valid() -> None:
    payload = wav_bytes(tone(0.1), 16_000)
    assert payload.startswith(b"RIFF")
    with wave.open(io.BytesIO(payload)) as handle:
        assert handle.getnchannels() == 1
        assert handle.getsampwidth() == 2
        assert handle.getframerate() == 16_000
        assert handle.getnframes() == 1_600


def test_vad_emits_utterance_after_silence() -> None:
    vad = StreamingVad(sample_rate=16_000, frame_ms=20)
    frame_samples = 320
    emitted = []
    audio = np.concatenate([silence(0.2), tone(0.5), silence(0.5)])
    for start in range(0, audio.size, frame_samples):
        emitted.extend(vad.push(audio[start : start + frame_samples]))
    assert len(emitted) == 1
    utterance = emitted[0]
    assert 400 <= utterance.speech_ms <= 600
    assert utterance.duration_ms >= 700
    assert vad.speaking is False
    assert utterance.samples.size > 6_000


def test_vad_ignores_silence_and_short_blips() -> None:
    vad = StreamingVad(sample_rate=16_000, frame_ms=20, min_speech_ms=120)
    emitted = []
    for frame in np.array_split(np.concatenate([silence(1.0), tone(0.04)]), 52):
        emitted.extend(vad.push(frame))
    assert emitted == []
    assert vad.flush() is None


def test_vad_flush_closes_open_utterance() -> None:
    vad = StreamingVad(sample_rate=16_000, frame_ms=20)
    for frame in np.array_split(tone(0.5), 25):
        vad.push(frame)
    assert vad.speaking is True
    utterance = vad.flush()
    assert utterance is not None
    assert utterance.speech_ms >= 400
    assert vad.speaking is False


def test_current_audio_snapshot_tracks_speech() -> None:
    vad = StreamingVad(sample_rate=16_000, frame_ms=20)
    for frame in np.array_split(tone(0.3), 15):
        vad.push(frame)
    snapshot = vad.current_audio()
    assert snapshot.size >= 4_000
    assert pcm_bytes(snapshot)
