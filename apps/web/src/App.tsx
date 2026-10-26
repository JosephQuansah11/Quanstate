import {
  createDevice,
  getLanguage,
  type CapabilitiesResponse,
  type HealthResponse,
  type MemoryView,
} from "@quanstate/services";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "./components/Icon";
import { useTranslator } from "./hooks/useTranslator";
import { loadSettings, saveSettings, type AppSettings } from "./lib/storage";
import { LearnScreen } from "./screens/LearnScreen";
import { LiveScreen } from "./screens/LiveScreen";
import { PairScreen } from "./screens/PairScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

type View = "live" | "learn" | "settings";

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? window.location.origin).replace(/\/$/, "");

export default function App() {
  const device = useMemo(() => createDevice({ baseUrl: API_BASE }), []);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [view, setView] = useState<View>("live");
  const [pairOpen, setPairOpen] = useState<boolean>(() => !settings.paired);
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [memory, setMemory] = useState<MemoryView | null>(null);

  const translator = useTranslator({
    device,
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang,
    ttsMode: settings.ttsMode,
    inputMode: settings.inputMode,
    autoSpeak: settings.autoSpeak,
  });

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const refreshMemory = useCallback(async () => {
    try {
      setMemory(await device.memory());
    } catch {
      /* offline: keep the last known memory snapshot */
    }
  }, [device]);

  const refreshService = useCallback(async () => {
    try {
      const [healthResult, capabilityResult] = await Promise.all([device.health(), device.capabilities()]);
      setHealth(healthResult);
      setCapabilities(capabilityResult);
      setOnline(true);
      await refreshMemory();
    } catch {
      setOnline(false);
    }
  }, [device, refreshMemory]);

  useEffect(() => {
    saveSettings(settings);
    device.setLanguages(settings.sourceLang, settings.targetLang);
  }, [device, settings]);

  useEffect(() => {
    void refreshService();
    const timer = window.setInterval(() => void refreshService(), 20_000);
    return () => window.clearInterval(timer);
  }, [refreshService]);

  useEffect(() => {
    if (!settings.paired) return;
    void translator.connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.paired]);

  const resetMemory = useCallback(async () => {
    await device.learning.resetMemory(device.profile);
    await refreshMemory();
  }, [device, refreshMemory]);

  const source = getLanguage(settings.sourceLang);
  const target = getLanguage(settings.targetLang);

  if (pairOpen || !settings.paired) {
    return (
      <PairScreen
        sourceLang={settings.sourceLang}
        targetLang={settings.targetLang}
        firstRun={!settings.paired}
        onSelect={({ sourceLang, targetLang }) => {
          updateSettings({ sourceLang, targetLang, paired: true });
          setPairOpen(false);
        }}
        onStart={() => setView("live")}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button type="button" className="brand brand--button" onClick={() => setView("live")}>
          <span className="brand__mark"><Icon name="waveform" /></span>
          <span className="brand__name">Quanstate</span>
          <span className="brand__badge">beta</span>
        </button>

        <nav className="app-nav" aria-label="Main navigation">
          <button type="button" className={view === "live" ? "is-active" : ""} onClick={() => setView("live")}>
            <Icon name="mic" /> <span>Translate</span>
          </button>
          <button type="button" className={view === "learn" ? "is-active" : ""} onClick={() => { setView("learn"); void refreshMemory(); }}>
            <Icon name="learn" /> <span>Teach</span>
          </button>
          <button type="button" className={view === "settings" ? "is-active" : ""} onClick={() => setView("settings")}>
            <Icon name="settings" /> <span>Settings</span>
          </button>
        </nav>

        <div className="app-header__right">
          <button type="button" className="pair-summary" onClick={() => setPairOpen(true)}>
            <span dir={source?.direction}>{source?.code.toUpperCase()}</span>
            <Icon name="swap" />
            <span dir={target?.direction}>{target?.code.toUpperCase()}</span>
          </button>
          <span className={`status-chip ${online ? "is-good" : "is-warn"}`} title={online ? "Service reachable" : "Service unreachable"}>
            <span className="status-dot" />
            <span className="status-chip__text">{online ? "live" : "offline"}</span>
          </span>
        </div>
      </header>

      <main className="app-main">
        {view === "live" ? (
          <LiveScreen
            translator={translator}
            sourceLang={settings.sourceLang}
            targetLang={settings.targetLang}
            online={online}
            memory={memory}
            autoSpeak={settings.autoSpeak}
            apiBase={API_BASE}
            onToggleAutoSpeak={(enabled) => updateSettings({ autoSpeak: enabled })}
            onOpenPair={() => setPairOpen(true)}
            onOpenLearn={() => setView("learn")}
          />
        ) : null}
        {view === "learn" ? (
          <LearnScreen
            device={device}
            sourceLang={settings.sourceLang}
            targetLang={settings.targetLang}
            memory={memory}
            onRefresh={refreshMemory}
          />
        ) : null}
        {view === "settings" ? (
          <SettingsScreen
            settings={settings}
            ready={translator.ready}
            health={health}
            capabilities={capabilities}
            memory={memory}
            apiBase={API_BASE}
            onChange={updateSettings}
            onResetMemory={resetMemory}
          />
        ) : null}
      </main>
    </div>
  );
}
