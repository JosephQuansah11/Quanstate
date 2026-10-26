"""Speech-to-text engines.

``faster-whisper`` (CPU int8) and OpenAI-compatible HTTP endpoints are both
supported.  The VAD lives in the pipeline, so every engine receives exact
utterance audio and can return a final transcript without re-segmenting.
"""

from __future__ import annotations

import asyncio
import math
from typing import Any, Sequence

import numpy as np

from ..audio import resample, wav_bytes
from ..languages import get_language
from ..config import http_verify_option
from .base import EngineError, Transcription


class NullTranscriber:
    """Audio is measured/VAD'd but not transcribed (client does on-device STT)."""

    name = "none"
    supports_partials = False

    async def transcribe(
        self,
        samples: np.ndarray,
        sample_rate: int,
        language: str,
        hotwords: Sequence[str] = (),
        *,
        partial: bool = False,
    ) -> Transcription:
        return Transcription(text="", language=language, confidence=0.0, detail={"engine": self.name})

    async def close(self) -> None:
        return None


class ScriptedTranscriber:
    """Deterministic test/demo double: returns pre-registered utterances.

    Used by CI, latency benchmarks and offline demos where downloading a Whisper
    checkpoint is not an option.  It only activates when ``QUANSTATE_STT=scripted``
    is set explicitly.
    """

    name = "scripted"
    supports_partials = False

    def __init__(self, cues: Sequence[str] | None = None) -> None:
        self._cues = list(cues or [])
        self._lock = asyncio.Lock()

    def push(self, *cues: str) -> None:
        self._cues.extend(cues)

    async def transcribe(
        self,
        samples: np.ndarray,
        sample_rate: int,
        language: str,
        hotwords: Sequence[str] = (),
        *,
        partial: bool = False,
    ) -> Transcription:
        if partial:
            return Transcription(text="", language=language, confidence=0.0)
        async with self._lock:
            text = self._cues.pop(0) if self._cues else ""
        return Transcription(
            text=text,
            language=language,
            confidence=0.99 if text else 0.0,
            duration_ms=len(samples) / sample_rate * 1000.0,
            detail={"engine": self.name, "remainingCues": len(self._cues)},
        )

    async def close(self) -> None:
        self._cues.clear()


class FasterWhisperTranscriber:
    """Local Whisper inference (CTranslate2, int8) on a worker thread."""

    name = "faster-whisper"
    supports_partials = True

    def __init__(self, model_size: str = "tiny", compute_type: str = "int8", device: str = "cpu") -> None:
        self.model_size = model_size
        self.compute_type = compute_type
        self.device = device
        self._model: Any = None
        self._load_lock = asyncio.Lock()
        self._infer_lock = asyncio.Lock()

    @staticmethod
    def available() -> bool:
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return False
        return True

    async def _ensure_model(self) -> Any:
        if self._model is not None:
            return self._model
        async with self._load_lock:
            if self._model is not None:
                return self._model
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:  # pragma: no cover - optional extra
                raise EngineError("local STT needs faster-whisper (pip install 'quanstate[stt]')") from exc
            self._model = await asyncio.to_thread(
                WhisperModel,
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
            )
        return self._model

    def _run_model(self, audio: np.ndarray, language: str, hotwords: Sequence[str]) -> tuple[str, float]:
        model = self._model
        prompt = ", ".join(hotwords[:60]) if hotwords else None
        segments, _info = model.transcribe(
            audio,
            language=get_language(language).whisper,
            beam_size=1,
            best_of=1,
            temperature=0.0,
            vad_filter=False,
            condition_on_previous_text=False,
            initial_prompt=prompt,
            without_timestamps=True,
        )
        texts: list[str] = []
        logprobs: list[float] = []
        for segment in segments:
            if segment.text.strip():
                texts.append(segment.text.strip())
                logprobs.append(float(getattr(segment, "avg_logprob", -1.0)))
        confidence = math.exp(sum(logprobs) / len(logprobs)) if logprobs else 0.0
        return " ".join(texts).strip(), confidence

    async def transcribe(
        self,
        samples: np.ndarray,
        sample_rate: int,
        language: str,
        hotwords: Sequence[str] = (),
        *,
        partial: bool = False,
    ) -> Transcription:
        await self._ensure_model()
        audio = np.ascontiguousarray(samples, dtype=np.float32)
        if sample_rate != 16_000:
            audio = resample(audio, sample_rate, 16_000)
        if partial:
            audio = audio[-16_000 * 8 :]
        async with self._infer_lock:
            text, confidence = await asyncio.to_thread(self._run_model, audio, language, hotwords)
        return Transcription(
            text=text,
            language=language,
            confidence=round(confidence, 4),
            duration_ms=len(audio) / 16_000 * 1000.0,
            detail={"engine": self.name, "model": self.model_size, "partial": partial},
        )

    async def close(self) -> None:
        self._model = None


class HttpWhisperTranscriber:
    """OpenAI-compatible ``/v1/audio/transcriptions`` provider."""

    name = "http"
    supports_partials = False

    def __init__(self, endpoint: str, api_key: str = "", model: str = "whisper-1", timeout: float = 8.0) -> None:
        if not endpoint:
            raise EngineError("HttpWhisperTranscriber requires an endpoint URL")
        self.endpoint = endpoint
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self._client: Any = None

    async def _get_client(self) -> Any:
        if self._client is None:
            try:
                import httpx
            except ImportError as exc:  # pragma: no cover
                raise EngineError("HTTP STT needs httpx") from exc
            headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
            self._client = httpx.AsyncClient(timeout=self.timeout, headers=headers, verify=http_verify_option())
        return self._client

    async def transcribe(
        self,
        samples: np.ndarray,
        sample_rate: int,
        language: str,
        hotwords: Sequence[str] = (),
        *,
        partial: bool = False,
    ) -> Transcription:
        client = await self._get_client()
        payload = wav_bytes(samples, sample_rate)
        data = {"model": self.model, "language": get_language(language).whisper, "response_format": "json"}
        if hotwords:
            data["prompt"] = ", ".join(hotwords[:60])
        try:
            response = await client.post(
                self.endpoint,
                data=data,
                files={"file": ("utterance.wav", payload, "audio/wav")},
            )
            response.raise_for_status()
            body = response.json()
        except Exception as exc:
            raise EngineError(f"speech provider failed: {exc}") from exc
        text = body.get("text", "") if isinstance(body, dict) else ""
        return Transcription(
            text=text.strip(),
            language=language,
            confidence=0.9 if text else 0.0,
            duration_ms=len(samples) / sample_rate * 1000.0,
            detail={"engine": self.name, "model": self.model},
        )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
