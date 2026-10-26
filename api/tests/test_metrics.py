from __future__ import annotations

import time

from quanstate.config import LatencyBudget
from quanstate.metrics import LatencyRecorder


def test_percentiles_and_counters() -> None:
    recorder = LatencyRecorder()
    for value in range(1, 101):
        recorder.record("translation", float(value))
    recorder.increment("stt_empty", 2)
    summary = recorder.summary()["translation"]
    assert summary["count"] == 100
    assert summary["p50"] == 50
    assert summary["p95"] == 95
    assert summary["p99"] == 99
    assert summary["max"] == 100
    assert recorder.counters() == {"stt_empty": 2}


def test_budget_violation_is_reported() -> None:
    recorder = LatencyRecorder()
    for _ in range(20):
        recorder.record("e2e", 240)
        recorder.record("translation", 0.2)
    status = recorder.budget_status(LatencyBudget())
    assert status["ok"] is False
    assert status["violations"] == [{"stage": "e2e", "p95": 240, "budgetMs": 100.0}]
    assert status["targets"]["fastPathMs"] == 5.0


def test_timer_records_and_reset_clears() -> None:
    recorder = LatencyRecorder()
    with recorder.timer("tts_first_byte"):
        time.sleep(0.002)
    assert recorder.summary()["tts_first_byte"]["p50"] >= 1.0
    recorder.reset()
    assert recorder.summary() == {}
    assert recorder.counters() == {}


def test_invalid_samples_are_ignored() -> None:
    recorder = LatencyRecorder()
    recorder.record("stt", -1)
    recorder.record("stt", float("nan"))
    assert recorder.summary() == {}
