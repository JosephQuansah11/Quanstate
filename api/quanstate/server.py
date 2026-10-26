"""FastAPI application: REST control plane + realtime WebSocket data plane."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .audio import wav_bytes
from .config import Settings, load_settings
from .engines.base import EngineError, TranslationHints
from .engines.registry import EngineSet, build_engine_set, capabilities
from .languages import LanguageError, public_catalogue, require_pair
from .learning.documents import DocumentError, extract_document_text
from .learning.store import MemoryStore, StoreError
from .learning.youtube import YouTubeError, YouTubeLearner
from .metrics import LatencyRecorder
from .pipeline import DuplexPipeline
from .protocol import (
    CLIENT_AUDIO_FLUSH,
    CLIENT_CONFIG_UPDATE,
    CLIENT_HELLO,
    CLIENT_PING,
    CLIENT_SESSION_START,
    CLIENT_SESSION_STOP,
    CLIENT_TEXT_INPUT,
    MessageError,
    SessionConfig,
    decode_client_message,
    encode,
    error,
    new_id,
    pong,
    text_input,
)

LOGGER = logging.getLogger("quanstate.server")
SERVICE_VERSION = "1.0.0"


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    sourceLang: str = "en"
    targetLang: str = "es"
    profile: str = "default"


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    language: str = "en"


class LearnTextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2_000_000)
    filename: str = "upload.txt"
    sourceLang: str = "en"
    targetLang: str = "es"
    profile: str = "default"
    title: str = ""


class YouTubeRequest(BaseModel):
    url: str = Field(min_length=3)
    sourceLang: str = "en"
    targetLang: str = "es"
    profile: str = "default"
    bilingual: bool = True


class MemoryResetRequest(BaseModel):
    profile: str = "default"


def _memory_view(snapshot: Any, limit: int = 100) -> dict[str, Any]:
    glossary = [
        {"source": source, "target": target}
        for (_src, _tgt, source), target in list(snapshot.glossary.items())[:limit]
    ]
    return {
        "profile": snapshot.profile,
        "version": snapshot.version,
        "stats": dict(snapshot.stats),
        "documents": list(snapshot.documents)[:20],
        "glossary": glossary,
        "hotwords": {language: list(words)[:60] for language, words in snapshot.hotwords.items()},
    }


def create_app(
    settings: Settings | None = None,
    store: MemoryStore | None = None,
    engines: EngineSet | None = None,
    youtube_fetcher: Any = None,
) -> FastAPI:
    settings = settings or load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    store = store or MemoryStore(settings.data_dir / "memory")
    engines = engines or build_engine_set(settings, store)
    metrics = LatencyRecorder()
    learner = YouTubeLearner(store, youtube_fetcher)
    started_at = time.time()

    app = FastAPI(title="Quanstate Translation Device API", version=SERVICE_VERSION)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = settings
    app.state.store = store
    app.state.engines = engines
    app.state.metrics = metrics
    app.state.learner = learner
    app.state.started_at = started_at


    # ------------------------------------------------------------------- REST
    @app.get("/v1/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "service": "quanstate-api",
            "version": SERVICE_VERSION,
            "uptimeSeconds": round(time.time() - started_at, 1),
            "engines": {
                "translation": engines.translation_provider,
                "speechToText": engines.stt_provider,
                "textToSpeech": engines.tts_provider,
            },
        }

    @app.get("/v1/languages")
    async def languages() -> dict[str, Any]:
        return public_catalogue()

    @app.get("/v1/capabilities")
    async def get_capabilities() -> dict[str, Any]:
        return {
            "protocolVersion": 1,
            "engines": {
                "translation": engines.translation_provider,
                "speechToText": engines.stt_provider,
                "textToSpeech": engines.tts_provider,
            },
            "capabilities": capabilities(settings, engines),
        }

    async def _render_wav(text: str, language: str) -> bytes:
        try:
            from .languages import get_language

            get_language(language)
        except LanguageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        import numpy as np

        chunks: list[Any] = []
        started = time.perf_counter()
        try:
            sample_rate = int(getattr(engines.synthesizer, "sample_rate", settings.sample_rate))
            async for frame in engines.synthesizer.stream(text, language):
                if frame.size:
                    chunks.append(frame)
        except EngineError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        metrics.record("tts_first_byte", (time.perf_counter() - started) * 1000.0)
        if not chunks:
            raise HTTPException(status_code=422, detail="nothing to synthesize")
        audio = np.concatenate(chunks)
        return wav_bytes(audio, sample_rate)

    @app.post("/v1/translate")
    async def translate(payload: TranslateRequest) -> dict[str, Any]:
        try:
            require_pair(payload.sourceLang, payload.targetLang)
        except LanguageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        snapshot = store.snapshot(payload.profile)
        started = time.perf_counter()
        try:
            result = await engines.translator.translate(
                payload.text,
                payload.sourceLang,
                payload.targetLang,
                TranslationHints(profile=payload.profile, memory_version=snapshot.version),
            )
        except EngineError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        elapsed = (time.perf_counter() - started) * 1000.0
        metrics.record("translation", elapsed)
        if result.cached:
            metrics.record("fast_path", elapsed)
        return {
            "text": result.text,
            "sourceText": result.source_text,
            "sourceLang": payload.sourceLang,
            "targetLang": payload.targetLang,
            "engine": result.engine,
            "cached": result.cached,
            "confidence": result.confidence,
            "coverage": result.coverage,
            "glossaryHits": list(result.glossary_hits),
            "latencyMs": round(elapsed, 3),
        }

    @app.post("/v1/tts")
    async def synthesize(payload: TtsRequest) -> Response:
        wav = await _render_wav(payload.text, payload.language)
        return Response(content=wav, media_type="audio/wav")

    @app.get("/v1/metrics")
    async def get_metrics() -> dict[str, Any]:
        return {
            "service": metrics.snapshot(settings.latency_budget),
            "budget": settings.latency_budget.__dict__,
            "engines": {
                "translation": engines.translation_provider,
                "speechToText": engines.stt_provider,
                "textToSpeech": engines.tts_provider,
            },
        }

    @app.post("/v1/metrics/reset")
    async def reset_metrics() -> dict[str, str]:
        metrics.reset()
        return {"status": "reset"}


    # --------------------------------------------------------------- learning
    def _check_pair(source_lang: str, target_lang: str) -> None:
        try:
            require_pair(source_lang, target_lang)
        except LanguageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/v1/learn/documents")
    async def learn_document(
        file: UploadFile = File(...),
        sourceLang: str = Form("en"),
        targetLang: str = Form("es"),
        profile: str = Form("default"),
        title: str = Form(""),
    ) -> dict[str, Any]:
        _check_pair(sourceLang, targetLang)
        raw = await file.read()
        try:
            text, kind = extract_document_text(file.filename or "upload.txt", raw)
        except DocumentError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not text.strip():
            raise HTTPException(status_code=422, detail="the document contained no readable text")
        try:
            record = await asyncio.to_thread(
                store.learn_text,
                profile,
                sourceLang,
                targetLang,
                text,
                origin="document",
                title=title or (file.filename or "document"),
                metadata={"filename": file.filename, "kind": kind, "bytes": len(raw)},
            )
        except StoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"document": record, "memory": _memory_view(store.snapshot(profile))}

    @app.post("/v1/learn/text")
    async def learn_plain_text(payload: LearnTextRequest) -> dict[str, Any]:
        _check_pair(payload.sourceLang, payload.targetLang)
        try:
            text, kind = extract_document_text(payload.filename, payload.text.encode("utf-8"))
        except DocumentError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        record = await asyncio.to_thread(
            store.learn_text,
            payload.profile,
            payload.sourceLang,
            payload.targetLang,
            text,
            origin="document",
            title=payload.title or payload.filename,
            metadata={"filename": payload.filename, "kind": kind},
        )
        return {"document": record, "memory": _memory_view(store.snapshot(payload.profile))}

    @app.post("/v1/learn/youtube")
    async def learn_youtube(payload: YouTubeRequest) -> dict[str, Any]:
        _check_pair(payload.sourceLang, payload.targetLang)
        try:
            record = await learner.learn(
                payload.url,
                payload.sourceLang,
                payload.targetLang,
                profile=payload.profile,
                bilingual=payload.bilingual,
            )
        except YouTubeError as exc:
            message = str(exc)
            status = 400 if "video id" in message or "URL" in message else 502
            raise HTTPException(status_code=status, detail=message) from exc
        return {"document": record, "memory": _memory_view(store.snapshot(payload.profile))}

    @app.get("/v1/memory/{profile}")
    async def get_memory(profile: str) -> dict[str, Any]:
        try:
            snapshot = store.snapshot(profile)
        except StoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _memory_view(snapshot, limit=300)

    @app.delete("/v1/memory/{profile}")
    async def delete_memory(profile: str) -> dict[str, Any]:
        try:
            store.reset(profile)
        except StoreError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"status": "reset", **_memory_view(store.snapshot(profile))}

    @app.get("/v1/profiles")
    async def list_profiles() -> dict[str, Any]:
        return {"profiles": store.profiles() or ["default"]}

    # --------------------------------------------------------------- realtime
    @app.websocket("/v1/realtime")
    async def realtime(socket: WebSocket) -> None:
        await socket.accept()
        send_lock = asyncio.Lock()
        pipeline: DuplexPipeline | None = None

        async def send(message: dict[str, Any]) -> None:
            async with send_lock:
                await socket.send_text(encode(message))

        async def send_audio(data: bytes) -> None:
            async with send_lock:
                await socket.send_bytes(data)

        try:
            while True:
                frame = await socket.receive()
                if frame.get("type") == "websocket.disconnect":
                    break

                data = frame.get("bytes")
                if data is not None:
                    if pipeline is None:
                        await send(error("send session.start before audio", "no_session"))
                    elif len(data) > settings.max_frame_bytes:
                        await send(error("audio frame too large", "frame_too_large"))
                    else:
                        await pipeline.feed_audio(data)
                    continue

                raw = frame.get("text")
                if raw is None:
                    continue
                try:
                    message = decode_client_message(raw)
                    kind = message["type"]

                    if kind in (CLIENT_HELLO, CLIENT_SESSION_START):
                        config = SessionConfig.from_message(message, settings.sample_rate)
                        if pipeline is None:
                            pipeline = DuplexPipeline(
                                config=config,
                                engines=engines,
                                store=store,
                                send=send,
                                send_audio=send_audio,
                                settings=settings,
                                metrics=metrics,
                            )
                            await pipeline.start()
                        else:
                            await pipeline.update_config(
                                {"targetLang": config.target, "sourceLang": config.source, "ttsMode": config.tts_mode}
                            )
                    elif kind == CLIENT_AUDIO_FLUSH:
                        if pipeline is not None:
                            await pipeline.flush_audio()
                    elif kind == CLIENT_TEXT_INPUT:
                        if pipeline is None:
                            await send(error("send session.start before text", "no_session"))
                        else:
                            text, segment_id = text_input(message)
                            await pipeline.feed_text(text, segment_id)
                    elif kind == CLIENT_CONFIG_UPDATE:
                        if pipeline is None:
                            await send(error("no active session", "no_session"))
                        else:
                            try:
                                await pipeline.update_config(message)
                            except (LanguageError, ValueError) as exc:
                                await send(error(str(exc), "config_error"))
                    elif kind == CLIENT_PING:
                        await send(pong(message.get("t")))
                    elif kind == CLIENT_SESSION_STOP:
                        if pipeline is not None:
                            await pipeline.send_stats()
                            await pipeline.close()
                            pipeline = None
                        await send({"type": "session.stopped"})
                    else:
                        await send(error(f"unsupported message type {kind!r}", "unsupported"))
                except MessageError as exc:
                    await send(error(str(exc), "bad_message"))
                except LanguageError as exc:
                    await send(error(str(exc), "unsupported_language"))
                except Exception as exc:  # pragma: no cover - defensive
                    LOGGER.exception("websocket handler error")
                    await send(error(f"internal error: {exc}", "internal", recoverable=False))
        except WebSocketDisconnect:
            pass
        finally:
            if pipeline is not None:
                await pipeline.close()

    web_dist = Path(__file__).resolve().parents[2] / "apps" / "web" / "dist"
    if web_dist.exists():
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="web")

    return app


app = create_app()


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(__import__("os").environ.get("PORT", "8000")))
