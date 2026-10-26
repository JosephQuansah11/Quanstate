/** Latency percentiles and budget assertions for clients and CI benchmarks. */

export interface StageSummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface LatencySample {
  /** Time from end-of-speech to translated text on screen. */
  endToEndMs: number;
  /** Server-side translation stage. */
  translationMs?: number;
  sttMs?: number;
  cached?: boolean;
}

export interface BudgetReport {
  samples: number;
  p50: number;
  p95: number;
  max: number;
  budgetMs: number;
  fastPathMs: number;
  fastPathP95: number;
  cacheHitRate: number;
  withinBudget: boolean;
  withinFastPath: boolean;
}

export function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(fraction * sortedValues.length) - 1));
  return sortedValues[index] ?? 0;
}

export function summarize(values: readonly number[]): StageSummary {
  if (values.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1] ?? 0),
    mean: round(total / sorted.length),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export class LatencyStats {
  private readonly buckets = new Map<string, number[]>();

  constructor(readonly windowSize = 512) {}

  record(stage: string, milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    let bucket = this.buckets.get(stage);
    if (!bucket) {
      bucket = [];
      this.buckets.set(stage, bucket);
    }
    bucket.push(milliseconds);
    if (bucket.length > this.windowSize) {
      bucket.splice(0, bucket.length - this.windowSize);
    }
  }

  summary(): Record<string, StageSummary> {
    const output: Record<string, StageSummary> = {};
    for (const [stage, values] of this.buckets) {
      output[stage] = summarize(values);
    }
    return output;
  }

  reset(): void {
    this.buckets.clear();
  }
}

export class BudgetTracker {
  private readonly samples: LatencySample[] = [];
  private cacheHits = 0;

  constructor(
    readonly budgetMs = 100,
    readonly fastPathMs = 5,
    readonly windowSize = 512,
  ) {}

  record(sample: LatencySample): void {
    if (!Number.isFinite(sample.endToEndMs) || sample.endToEndMs < 0) return;
    this.samples.push(sample);
    if (sample.cached) this.cacheHits += 1;
    if (this.samples.length > this.windowSize) {
      const removed = this.samples.shift();
      if (removed?.cached) this.cacheHits = Math.max(0, this.cacheHits - 1);
    }
  }

  report(): BudgetReport {
    const endToEnd = this.samples.map((sample) => sample.endToEndMs);
    const cached = this.samples.filter((sample) => sample.cached).map((sample) => sample.endToEndMs);
    const summary = summarize(endToEnd);
    return {
      samples: endToEnd.length,
      p50: summary.p50,
      p95: summary.p95,
      max: summary.max,
      budgetMs: this.budgetMs,
      fastPathMs: this.fastPathMs,
      fastPathP95: summarize(cached).p95,
      cacheHitRate: endToEnd.length === 0 ? 0 : round(this.cacheHits / endToEnd.length),
      withinBudget: summary.count === 0 ? true : summary.p95 <= this.budgetMs,
      withinFastPath: cached.length === 0 ? true : summarize(cached).p95 <= this.fastPathMs,
    };
  }

  reset(): void {
    this.samples.length = 0;
    this.cacheHits = 0;
  }
}
