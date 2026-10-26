import { describe, expect, it } from "vitest";

import { BudgetTracker, LatencyStats, percentile, summarize } from "../src/metrics";

describe("latency metrics", () => {
  it("computes nearest-rank percentiles", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 0.99)).toBe(99);
    expect(percentile([], 0.95)).toBe(0);
  });

  it("summarises and trims its window", () => {
    const stats = new LatencyStats(5);
    for (const value of [1, 2, 3, 4, 5, 6, 7]) stats.record("translation", value);
    const summary = stats.summary().translation;
    expect(summary?.count).toBe(5);
    expect(summary?.max).toBe(7);
    expect(summary?.p50).toBe(5);
    expect(summarize([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 });
  });

  it("tracks end-to-end and cached fast-path budgets", () => {
    const tracker = new BudgetTracker(100, 5);
    for (let index = 0; index < 20; index += 1) {
      tracker.record({ endToEndMs: 42, translationMs: 1.2, cached: false });
      tracker.record({ endToEndMs: 1.4, translationMs: 0.3, cached: true });
    }
    const report = tracker.report();
    expect(report.samples).toBe(40);
    expect(report.p95).toBeCloseTo(42, 1);
    expect(report.cacheHitRate).toBe(0.5);
    expect(report.withinBudget).toBe(true);
    expect(report.withinFastPath).toBe(true);
    expect(report.fastPathP95).toBeLessThanOrEqual(5);
  });

  it("flags a budget violation", () => {
    const tracker = new BudgetTracker(100, 5);
    tracker.record({ endToEndMs: 240 });
    tracker.record({ endToEndMs: 260 });
    const report = tracker.report();
    expect(report.withinBudget).toBe(false);
    tracker.reset();
    expect(tracker.report().samples).toBe(0);
  });
});
