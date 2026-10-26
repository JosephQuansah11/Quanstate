import { describe, expect, it } from "vitest";

import {
  FRAME_SAMPLES,
  PcmFrameChunker,
  PcmPlaybackBuffer,
  downsample,
  floatToPcm16,
  pcm16ToFloat,
  rms,
} from "../src/pcm";

function sine(frequency: number, sampleRate: number, seconds: number, amplitude = 0.5): Float32Array {
  const total = Math.round(sampleRate * seconds);
  const samples = new Float32Array(total);
  for (let index = 0; index < total; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }
  return samples;
}

describe("pcm", () => {
  it("decimates 48 kHz capture by a box filter to 16 kHz", () => {
    const input = sine(440, 48_000, 0.1);
    const output = downsample(input, 48_000, 16_000);
    expect(output.length).toBe(1_600);
    expect(Math.abs(rms(output) - rms(input))).toBeLessThan(0.02);
  });

  it("resamples non-integer rates with linear interpolation", () => {
    const input = sine(300, 44_100, 0.05);
    const output = downsample(input, 44_100, 16_000);
    expect(output.length).toBe(800);
    expect(rms(output)).toBeGreaterThan(0.2);
  });

  it("round-trips PCM16 within quantisation error", () => {
    const input = sine(220, 16_000, 0.02, 0.8);
    const restored = pcm16ToFloat(floatToPcm16(input));
    expect(restored.length).toBe(input.length);
    for (let index = 0; index < input.length; index += 32) {
      expect(Math.abs((restored[index] ?? 0) - (input[index] ?? 0))).toBeLessThan(0.001);
    }
  });

  it("emits exact 20 ms frames and keeps the remainder", () => {
    const chunker = new PcmFrameChunker(FRAME_SAMPLES, 16_000);
    const frames = chunker.push(sine(440, 16_000, 0.05));
    expect(frames).toHaveLength(2);
    expect(frames[0]?.length).toBe(FRAME_SAMPLES * 2);
    const tail = chunker.flush();
    expect(tail?.length).toBe(160 * 2);
    expect(chunker.flush()).toBeUndefined();
  });

  it("clamps out-of-range samples instead of wrapping", () => {
    const pcm = floatToPcm16(new Float32Array([2, -2]));
    expect(pcm16ToFloat(pcm)[0]).toBeCloseTo(1, 3);
    expect(pcm16ToFloat(pcm)[1]).toBeCloseTo(-1, 3);
  });

  it("converts a 20 ms capture frame inside the 5 ms hot-path budget", () => {
    const input = sine(440, 48_000, 0.02);
    const durations: number[] = [];
    for (let index = 0; index < 300; index += 1) {
      const started = performance.now();
      const resampled = downsample(input, 48_000, 16_000);
      floatToPcm16(resampled);
      durations.push(performance.now() - started);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95) - 1] ?? 0;
    expect(p95).toBeLessThan(5);
  });

  it("bounds the playback buffer by dropping the oldest audio", () => {
    const buffer = new PcmPlaybackBuffer(10);
    buffer.push(new Float32Array(6).fill(1));
    buffer.push(new Float32Array(6).fill(2));
    expect(buffer.bufferedSamples).toBe(6);
    const head = buffer.pull(4);
    expect(head?.every((value) => value === 2)).toBe(true);
    buffer.clear();
    expect(buffer.bufferedSamples).toBe(0);
  });
});
