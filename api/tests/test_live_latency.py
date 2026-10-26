"""Live-server benchmark over a real WebSocket (not the in-process test client)."""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import numpy as np
import pytest
from websockets.asyncio.client import connect

from tests.conftest import pcm_bytes, silence, tone

API_DIR = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="module")
def live_server(tmp_path_factory: pytest.TempPathFactory):
    port = free_port()
    data_dir = tmp_path_factory.mktemp("live-runtime")
    env = {
        **os.environ,
        "QUANSTATE_DATA_DIR": str(data_dir),
        "QUANSTATE_STT": "none",
        "QUANSTATE_TRANSLATOR": "memory",
        "PYTHONPATH": str(API_DIR),
    }
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "quanstate.server:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=str(API_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    base_url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 25
    while time.time() < deadline:
        if process.poll() is not None:
            output = process.stdout.read().decode() if process.stdout else ""
            raise RuntimeError(f"uvicorn exited early: {output}")
        try:
            if httpx.get(f"{base_url}/v1/health", timeout=0.5).status_code == 200:
                break
        except Exception:
            time.sleep(0.15)
    else:
        process.terminate()
        raise RuntimeError("uvicorn did not become healthy")

    yield base_url
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


async def test_live_text_roundtrip_is_far_below_100ms(live_server: str) -> None:
    ws_url = live_server.replace("http://", "ws://") + "/v1/realtime"
    latencies: list[float] = []
    server_translation: list[float] = []
    server_e2e: list[float] = []
    cached_flags: list[bool] = []

    async with connect(ws_url) as ws:
        await ws.send(
            json.dumps(
                {
                    "type": "session.start",
                    "sourceLang": "en",
                    "targetLang": "es",
                    "sampleRate": 16_000,
                    "ttsMode": "client",
                }
            )
        )
        ready = json.loads(await ws.recv())
        assert ready["type"] == "session.ready"

        phrases = ["hello", "thank you", "where is the bathroom?", "i need help"]
        for index in range(60):
            text = phrases[index % len(phrases)]
            started = time.perf_counter()
            await ws.send(json.dumps({"type": "text.input", "text": text}))
            final = json.loads(await ws.recv())
            assert final["type"] == "stt.final"
            translation = json.loads(await ws.recv())
            assert translation["type"] == "translation"
            latencies.append((time.perf_counter() - started) * 1000)
            server_translation.append(translation["latency"]["translationMs"])
            server_e2e.append(translation["latency"]["endToEndMs"])
            cached_flags.append(translation["cached"])

        # Exercise the binary audio path on the live socket as well.
        speech = pcm_bytes(np.concatenate([tone(0.4), silence(0.4)]))
        for start in range(0, len(speech), 4096):
            await ws.send(speech[start : start + 4096])
        await ws.send(json.dumps({"type": "audio.flush"}))
        await asyncio.sleep(0.4)
        await ws.send(json.dumps({"type": "session.stop"}))
        stats = json.loads(await ws.recv())
        while stats["type"] != "stats":
            stats = json.loads(await ws.recv())

    percentile = lambda values, fraction: sorted(values)[min(len(values) - 1, int(len(values) * fraction))]
    report = {
        "clientRoundTripP50": round(percentile(latencies, 0.5), 2),
        "clientRoundTripP95": round(percentile(latencies, 0.95), 2),
        "clientRoundTripMax": round(max(latencies), 2),
        "serverTranslationP95": round(percentile(server_translation, 0.95), 3),
        "serverEndToEndP95": round(percentile(server_e2e, 0.95), 2),
        "cacheHitRate": round(sum(cached_flags) / len(cached_flags), 2),
        "framesIngested": stats["counters"]["frames"],
    }
    print("\nLIVE LATENCY REPORT", json.dumps(report))

    assert percentile(latencies, 0.95) < 100, report
    assert percentile(server_translation, 0.95) < 5, report
    assert sum(cached_flags) > len(cached_flags) * 0.6
    assert stats["counters"]["frames"] > 0
    assert stats["latency"]["budget"]["ok"] is True
