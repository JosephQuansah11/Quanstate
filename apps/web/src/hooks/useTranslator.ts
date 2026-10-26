import {
  MicrophoneStream,
  RealtimeSession,
  SpeechQueue,
  ServerVoicePlayer,
  type ServerMessage,
  type SessionReady,
  type StageLatency,
  type TransportStatus,
  type TranslationDevice,
} from "@quanstate/services";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createWebAudioCapture } from "../lib/mic";
import { BrowserSpeechSink, WebPcmPlayer } from "../lib/speech";
import { OnDeviceSpeech } from "../lib/stt";

export type InputMode = "auto" | "device" | "server" | "typed";

export interface ConversationEntry {
  id: string;
  sourceText: string;
  targetText: string;
  createdAt: number;
  cached: boolean;
  glossaryHits: string[];
  latency: StageLatency | null;
  confidence: number;
}

export interface LiveStats {
  samples: number;
  p50: number;
  p95: number;
  max: number;
  cacheHitRate: number;
  withinBudget: boolean;
  rttMs: number;
  droppedFrames: number;
  translations: number;
}

export interface UseTranslatorOptions {
  device: TranslationDevice;
  sourceLang: string;
  targetLang: string;
  ttsMode: "client" | "server";
  inputMode: InputMode;
  autoSpeak: boolean;
}

export function useTranslator(options: UseTranslatorOptions) {
  const { device, sourceLang, targetLang, ttsMode, inputMode, autoSpeak } = options;

  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState<TransportStatus>("idle");
  const [sessionState, setSessionState] = useState<RealtimeSession["state"]>("idle");
  const [ready, setReady] = useState<SessionReady | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [stats, setStats] = useState<LiveStats>({
    samples: 0, p50: 0, p95: 0, max: 0, cacheHitRate: 0,
    withinBudget: true, rttMs: 0, droppedFrames: 0, translations: 0,
  });

  const sessionRef = useRef<RealtimeSession | null>(null);
  const micRef = useRef<MicrophoneStream | null>(null);
  const speechQueueRef = useRef<SpeechQueue | null>(null);
  const serverPlayerRef = useRef<ServerVoicePlayer | null>(null);
  const sttRef = useRef<OnDeviceSpeech | null>(null);
  const ttsModeRef = useRef(ttsMode);
  const targetLangRef = useRef(targetLang);
  const sourceLangRef = useRef(sourceLang);
  const inputModeRef = useRef(inputMode);
  const autoSpeakRef = useRef(autoSpeak);
  const levelFrame = useRef(0);
  const connectPromise = useRef<Promise<RealtimeSession | null> | null>(null);

  ttsModeRef.current = ttsMode;
  targetLangRef.current = targetLang;
  sourceLangRef.current = sourceLang;
  inputModeRef.current = inputMode;
  autoSpeakRef.current = autoSpeak;

  const speechSink = useMemo(() => new BrowserSpeechSink(), []);
  const pcmPlayer = useMemo(() => new WebPcmPlayer(), []);
  const onDeviceSpeech = useMemo(() => new OnDeviceSpeech(), []);
  sttRef.current = onDeviceSpeech;

  if (!serverPlayerRef.current) {
    serverPlayerRef.current = new ServerVoicePlayer(pcmPlayer);
  }
  if (!speechQueueRef.current) {
    speechQueueRef.current = new SpeechQueue({ sink: speechSink, enabled: autoSpeak });
  }

  const pushEntry = useCallback((entry: ConversationEntry) => {
    setEntries((previous) => [entry, ...previous.filter((item) => item.id !== entry.id)].slice(0, 80));
  }, []);

  const handleServerEvent = useCallback((event: ServerMessage) => {
    if (event.type === "tts.start") {
      serverPlayerRef.current?.begin(event.id, event.sampleRate);
    } else if (event.type === "tts.end") {
      serverPlayerRef.current?.end(event.id);
    } else if (event.type === "stt.final") {
      setPartial("");
    } else if (event.type === "stt.partial") {
      setPartial(event.text);
    }
  }, []);

  const connect = useCallback(async (): Promise<RealtimeSession | null> => {
    if (sessionRef.current && sessionRef.current.state === "live") return sessionRef.current;
    if (connectPromise.current) return connectPromise.current;
    setError(null);

    const pending = (async () => {
      try {
        const session = await device.openSession({
          sourceLang: sourceLangRef.current,
          targetLang: targetLangRef.current,
          ttsMode: ttsModeRef.current,
          onStatus: (next) => {
            setStatus(next);
            if (sessionRef.current) setSessionState(sessionRef.current.state);
          },
          onEvent: handleServerEvent,
          onPartial: (text) => setPartial(text),
          onTranslation: (event) => {
            pushEntry({
              id: event.id,
              sourceText: event.sourceText,
              targetText: event.text,
              createdAt: Date.now(),
              cached: event.cached,
              glossaryHits: event.glossaryHits,
              latency: event.latency,
              confidence: event.confidence,
            });
            if (ttsModeRef.current === "client" && autoSpeakRef.current) {
              speechQueueRef.current?.enqueue(event.text, targetLangRef.current);
            }
          },
          onAudioChunk: (chunk, meta) => {
            if (ttsModeRef.current === "server") {
              serverPlayerRef.current?.push(meta.id, chunk);
            }
          },
          onError: (message) => setError(message),
        });
        sessionRef.current = session;
        setReady(session.ready);
        setStatus(session.transport.status);
        setSessionState(session.state);
        return session;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not reach the translation service");
        setStatus("closed");
        return null;
      }
    })();

    connectPromise.current = pending;
    try {
      return await pending;
    } finally {
      connectPromise.current = null;
    }
  }, [device, handleServerEvent, pushEntry]);

  const startListening = useCallback(async () => {
    const active = sessionRef.current ?? (await connect());
    if (!active) return;
    if (micRef.current?.isRunning) return;

    const capture = createWebAudioCapture();
    const mic = new MicrophoneStream(capture, {
      onFrame: (frame) => active.pushAudio(frame),
      onLevel: (next) => {
        levelFrame.current += 1;
        if (levelFrame.current % 3 === 0) setLevel(next);
      },
    });
    try {
      await mic.start();
      micRef.current = mic;
      setRecording(true);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Microphone permission denied");
      return;
    }

    const provider = active.ready?.engines.speechToText ?? "none";
    const mode = inputModeRef.current;
    const useDeviceStt = mode === "device" || (mode === "auto" && provider === "none" && onDeviceSpeech.available);
    if (useDeviceStt) {
      onDeviceSpeech.start(active.ready?.sourceLang ?? sourceLangRef.current, {
        onPartial: (text) => setPartial(text),
        onFinal: (text) => {
          setPartial("");
          active.sendText(text);
        },
        onError: (message) => setError(message),
      });
    }
  }, [connect, onDeviceSpeech]);

  const stopListening = useCallback(() => {
    onDeviceSpeech.stop();
    void micRef.current?.stop();
    micRef.current = null;
    sessionRef.current?.flushAudio();
    setRecording(false);
    setLevel(0);
    setPartial("");
  }, [onDeviceSpeech]);

  const sendText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const active = sessionRef.current ?? (await connect());
      if (!active) return;
      active.sendText(text.trim());
    },
    [connect],
  );

  const speak = useCallback((text: string) => {
    speechQueueRef.current?.enqueue(text, targetLangRef.current);
  }, []);

  const setAutoSpeak = useCallback((enabled: boolean) => {
    speechQueueRef.current?.setEnabled(enabled);
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    setPartial("");
  }, []);

  useEffect(() => {
    sessionRef.current?.setLanguages(sourceLang, targetLang);
    serverPlayerRef.current?.stop();
    speechQueueRef.current?.cancel();
  }, [sourceLang, targetLang]);

  useEffect(() => {
    sessionRef.current?.setTtsMode(ttsMode);
    serverPlayerRef.current?.stop();
  }, [ttsMode]);

  useEffect(() => {
    speechQueueRef.current?.setEnabled(autoSpeak);
  }, [autoSpeak]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      const report = session.budget.report();
      setStats({
        samples: report.samples,
        p50: report.p50,
        p95: report.p95,
        max: report.max,
        cacheHitRate: report.cacheHitRate,
        withinBudget: report.withinBudget,
        rttMs: session.rttMs,
        droppedFrames: session.transport.droppedAudioFrames,
        translations: session.stats.translations,
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      sttRef.current?.stop();
      void micRef.current?.stop();
      micRef.current = null;
      sessionRef.current?.dispose();
      sessionRef.current = null;
      speechQueueRef.current?.cancel();
      serverPlayerRef.current?.stop();
    };
  }, []);

  return {
    entries, partial, level, status, sessionState, ready, error, recording, stats,
    connect, startListening, stopListening, sendText, speak, setAutoSpeak, clear,
    onDeviceAvailable: onDeviceSpeech.available, setError,
  };
}
