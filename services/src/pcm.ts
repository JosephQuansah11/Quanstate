/**
 * PCM helpers shared by the web and React Native audio adapters.
 *
 * Browsers capture at 44.1/48 kHz; the service speaks 16 kHz mono PCM16.  All
 * conversion happens synchronously with pre-allocated typed arrays so a 20 ms
 * frame stays far below the 5 ms hot-path budget.
 */

export const TARGET_SAMPLE_RATE = 16_000;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (TARGET_SAMPLE_RATE * FRAME_MS) / 1000;

export function downsample(samples: Float32Array, inputRate: number, targetRate = TARGET_SAMPLE_RATE): Float32Array {
  if (inputRate === targetRate || samples.length === 0) {
    return samples;
  }
  if (inputRate % targetRate === 0) {
    const factor = inputRate / targetRate;
    const outputLength = Math.floor(samples.length / factor);
    if (outputLength === 0) return new Float32Array(0);
    const output = new Float32Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      let sum = 0;
      const base = index * factor;
      for (let offset = 0; offset < factor; offset += 1) {
        sum += samples[base + offset] ?? 0;
      }
      output[index] = sum / factor;
    }
    return output;
  }
  const ratio = inputRate / targetRate;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(samples.length - 1, lower + 1);
    const frac = position - lower;
    output[index] = (samples[lower] ?? 0) * (1 - frac) + (samples[upper] ?? 0) * frac;
  }
  return output;
}

export function floatToPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytes;
}

export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const samples = bytes.length >> 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
  const output = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 32768;
  }
  return output;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

/** Splits an arbitrary capture callback into exact 20 ms PCM16 frames. */
export class PcmFrameChunker {
  private buffer: Float32Array = new Float32Array(0);

  constructor(
    readonly frameSamples: number = FRAME_SAMPLES,
    readonly inputRate: number = TARGET_SAMPLE_RATE,
  ) {}

  push(samples: Float32Array): Uint8Array[] {
    const resampled = downsample(samples, this.inputRate, TARGET_SAMPLE_RATE);
    const merged = new Float32Array(this.buffer.length + resampled.length);
    merged.set(this.buffer, 0);
    merged.set(resampled, this.buffer.length);
    const frames: Uint8Array[] = [];
    let offset = 0;
    while (merged.length - offset >= this.frameSamples) {
      frames.push(floatToPcm16(merged.subarray(offset, offset + this.frameSamples)));
      offset += this.frameSamples;
    }
    this.buffer = merged.slice(offset);
    return frames;
  }

  flush(): Uint8Array | undefined {
    if (this.buffer.length === 0) return undefined;
    const frame = floatToPcm16(this.buffer);
    this.buffer = new Float32Array(0);
    return frame;
  }

  reset(): void {
    this.buffer = new Float32Array(0);
  }
}

/** Bounded buffer used by streaming TTS playback. */
export class PcmPlaybackBuffer {
  private queue: Float32Array[] = [];
  private total = 0;

  constructor(readonly capacitySamples: number = TARGET_SAMPLE_RATE * 30) {}

  push(samples: Float32Array): void {
    if (samples.length === 0) return;
    this.queue.push(samples);
    this.total += samples.length;
    while (this.total > this.capacitySamples && this.queue.length > 0) {
      const dropped = this.queue.shift();
      this.total -= dropped?.length ?? 0;
    }
  }

  pull(maxSamples: number): Float32Array | undefined {
    if (this.queue.length === 0) return undefined;
    const head = this.queue[0];
    if (!head) return undefined;
    if (head.length <= maxSamples) {
      this.queue.shift();
      this.total -= head.length;
      return head;
    }
    this.queue[0] = head.slice(maxSamples);
    this.total -= maxSamples;
    return head.slice(0, maxSamples);
  }

  get bufferedSamples(): number {
    return this.total;
  }

  clear(): void {
    this.queue = [];
    this.total = 0;
  }
}
