"""Low overhead latency accounting for every pipeline stage."""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from contextlib import contextmanager
from typing import Deque, Iterator

from .config import LatencyBudget

_BUDGET_STAGE_MAP = {
    "stt": "stt_ms",
    "translation": "translation_ms",
    "tts_first_byte": "tts_first_byte_ms",
    "e2e": "end_to_end_ms",
    "fast_path": "fast_path_ms",
}


class LatencyRecorder:
    """Rolling percentile tracker.

    Called once per audio frame / utterance so the implementation stays tiny and
    allocation-light: a bounded ``deque`` of floats plus an on-demand sort.
    """

    def __init__(self, window: int = 4096) -> None:
        self._window = window
        self._samples: dict[str, Deque[float]] = {}
        self._lock = threading.Lock()
        self._counters: dict[str, int] = {}

    def record(self, stage: str, milliseconds: float) -> None:
        if milliseconds < 0 or math.isnan(milliseconds):
            return
        with self._lock:
            bucket = self._samples.get(stage)
            if bucket is None:
                bucket = deque(maxlen=self._window)
                self._samples[stage] = bucket
            bucket.append(float(milliseconds))

    def increment(self, counter: str, amount: int = 1) -> None:
        with self._lock:
            self._counters[counter] = self._counters.get(counter, 0) + amount

    @contextmanager
    def timer(self, stage: str) -> Iterator[None]:
        started = time.perf_counter()
        try:
            yield
        finally:
            self.record(stage, (time.perf_counter() - started) * 1000.0)

    def counters(self) -> dict[str, int]:
        with self._lock:
            return dict(self._counters)

    def stages(self) -> list[str]:
        with self._lock:
            return sorted(self._samples)

    @staticmethod
    def _percentile(sorted_values: list[float], fraction: float) -> float:
        if not sorted_values:
            return 0.0
        index = min(len(sorted_values) - 1, max(0, math.ceil(fraction * len(sorted_values)) - 1))
        return sorted_values[index]

    def summary(self) -> dict[str, dict[str, float]]:
        with self._lock:
            snapshot = {stage: list(values) for stage, values in self._samples.items()}
        result: dict[str, dict[str, float]] = {}
        for stage, values in snapshot.items():
            if not values:
                continue
            ordered = sorted(values)
            result[stage] = {
                "count": len(ordered),
                "p50": round(self._percentile(ordered, 0.50), 3),
                "p90": round(self._percentile(ordered, 0.90), 3),
                "p95": round(self._percentile(ordered, 0.95), 3),
                "p99": round(self._percentile(ordered, 0.99), 3),
                "max": round(ordered[-1], 3),
                "mean": round(sum(ordered) / len(ordered), 3),
            }
        return result

    def budget_status(self, budget: LatencyBudget) -> dict[str, object]:
        summary = self.summary()
        violations: list[dict[str, float | str]] = []
        for stage, attribute in _BUDGET_STAGE_MAP.items():
            stats = summary.get(stage)
            if not stats:
                continue
            limit = getattr(budget, attribute)
            if stats["p95"] > limit:
                violations.append({"stage": stage, "p95": stats["p95"], "budgetMs": limit})
        return {
            "ok": not violations,
            "violations": violations,
            "targets": {
                "fastPathMs": budget.fast_path_ms,
                "endToEndMs": budget.end_to_end_ms,
                "sttMs": budget.stt_ms,
                "translationMs": budget.translation_ms,
                "ttsFirstByteMs": budget.tts_first_byte_ms,
            },
        }

    def snapshot(self, budget: LatencyBudget) -> dict[str, object]:
        return {
            "stages": self.summary(),
            "budget": self.budget_status(budget),
            "counters": self.counters(),
        }

    def reset(self) -> None:
        with self._lock:
            self._samples.clear()
            self._counters.clear()
