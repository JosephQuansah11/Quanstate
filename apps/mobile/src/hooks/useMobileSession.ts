import {
  RealtimeSession,
  SpeechQueue,
  type SessionReady,
  type StageLatency,
  type TranslationDevice,
  type TranslationEvent,
  type TransportStatus,
} from "@quanstate/services";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDeviceRecognition } from "../lib/recognition";
import { ExpoSpeechSink } from "../lib/speech";

export interface MobileEntry {
  id: string;
  sourceText: string;
  targetText: string;
  createdAt: number;
  cached: boolean;
  glossaryHits: string[];
  latency: StageLatency | null;
  confidence: number;
}

export interface MobileStats {
  samples: number;
  p50: number;
  p95: number;
  max: number;
  cacheHitRate: number;
  withinBudget: boolean;
}

interface Options {
  device: TranslationDevice;
  sourceLang: string;
  targetLang: string;
  autoSpeak: boolean;
}

export function useMobileSession({ device, sourceLang, targetLang, autoSpeak }: Options) {
  const [entries, setEntries] = useState<MobileEntry[]>([]);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<SessionReady | null>(null);
  const [status, setStatus] = useState<TransportStatus>("idle");
  const [stats, setStats] = useState<MobileStats>({
    samples: 0,
    p50: 0,
    p95: 0,
    max: 0,
    cacheHitRate: 0,
    withinBudget: true,
  });

  const sessionRef = useRef<RealtimeSession | null>(null);
  const sourceRef = useRef(sourceLang);
  const targetRef = useRef(targetLang);
  const autoSpeakRef = useRef(autoSpeak);
  const sendTextRef = useRef<(text: string) => void>(() => undefined);
  const speechSink = useMemo(() => new ExpoSpeechSink(), []);
  const queue = useMemo(() => new SpeechQueue({ sink: speechSink, enabled: autoSpeak }), [speechSink]);

  sourceRef.current = sourceLang;
  targetRef.current = targetLang;
  autoSpeakRef.current = autoSpeak;

  const handleTranslation = useCallback((event: TranslationEvent) => {
    setEntries((previous) => [
      {
        id: event.id,
        sourceText: event.sourceText,
        targetText: event.text,
        createdAt: Date.now(),
        cached: event.cached,
        glossaryHits: event.glossaryHits,
        latency: event.latency,
        confidence: event.confidence,
      },
      ...previous.filter((item) => item.id !== event.id),
    ].slice(0, 60));
    if (autoSpeakRef.current) {
      queue.enqueue(event.text, targetRef.current);
    }
  }, [queue]);

  const connect = useCallback(async (): Promise<RealtimeSession | null> => {
    if (sessionRef.current?.state === "live") return sessionRef.current;
    setError(null);
    try {
      const session = await device.openSession({
        sourceLang: sourceRef.current,
        targetLang: targetRef.current,
        ttsMode: "client",
        onStatus: setStatus,
        onPartial: setPartial,
        onFinal: () => setPartial(""),
        onTranslation: handleTranslation,
        onError: (message) => setError(message),
      });
      sessionRef.current = session;
      setReady(session.ready);
      return session;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cannot reach the translation service");
      return null;
    }
  }, [device, handleTranslation]);

  const sendText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const session = sessionRef.current ?? (await connect());
      session?.sendText(text.trim());
    },
    [connect],
  );
  sendTextRef.current = (text: string) => {
    void sendText(text);
  };

  const recognition = useDeviceRecognition({
    onPartial: setPartial,
    onFinal: (text) => {
      setPartial("");
      sendTextRef.current(text);
    },
    onError: setError,
  });

  const startListening = useCallback(async () => {
    setError(null);
    const session = sessionRef.current ?? (await connect());
    if (!session) return;
    await recognition.start(sourceRef.current);
  }, [connect, recognition]);

  const stopListening = useCallback(() => {
    recognition.stop();
  }, [recognition]);

  const speak = useCallback((text: string) => queue.enqueue(text, targetRef.current), [queue]);

  const clear = useCallback(() => {
    setEntries([]);
    setPartial("");
  }, []);

  useEffect(() => {
    queue.setEnabled(autoSpeak);
  }, [autoSpeak, queue]);

  useEffect(() => {
    sessionRef.current?.setLanguages(sourceLang, targetLang);
    queue.cancel();
  }, [sourceLang, targetLang, queue]);

  useEffect(() => {
    const timer = setInterval(() => {
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
      });
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      recognition.stop();
      queue.cancel();
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    entries,
    partial,
    error,
    ready,
    status,
    listening: recognition.listening,
    stats,
    connect,
    startListening,
    stopListening,
    sendText,
    speak,
    clear,
    setError,
  };
}
