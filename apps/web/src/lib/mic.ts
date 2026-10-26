import type { AudioCapture } from "@quanstate/services";

/**
 * Web Audio microphone capture.
 *
 * Uses an AudioWorklet when available (Chrome, Edge, Firefox, Safari 14.1+) and
 * falls back to a ScriptProcessor for older WebViews.  Frames arrive as
 * Float32Array chunks; `MicrophoneStream` downsamples them to 16 kHz PCM16.
 */

const WORKLET_SOURCE = `
class QuanstateCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}
registerProcessor("quanstate-capture", QuanstateCapture);
`;

class WebAudioCapture implements AudioCapture {
  sampleRate = 48_000;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;

  async start(onSamples: (samples: Float32Array, sampleRate: number) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not expose microphone capture");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    this.sampleRate = context.sampleRate;
    if (context.state === "suspended") {
      await context.resume();
    }
    this.source = context.createMediaStreamSource(this.stream);

    try {
      const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(context, "quanstate-capture");
      node.port.onmessage = (event: MessageEvent<Float32Array>) => onSamples(event.data, context.sampleRate);
      this.source.connect(node);
      const mute = context.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(context.destination);
      this.node = node;
    } catch {
      const processor = context.createScriptProcessor(1024, 1, 1);
      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        onSamples(new Float32Array(channel), context.sampleRate);
      };
      this.source.connect(processor);
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.connect(mute).connect(context.destination);
      this.node = processor;
    }
  }

  async stop(): Promise<void> {
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}

export function createWebAudioCapture(): AudioCapture {
  return new WebAudioCapture();
}
