import type { CapabilitiesResponse, HealthResponse, MemoryView, SessionReady } from "@quanstate/services";

import { Icon } from "../components/Icon";
import type { AppSettings, InputPreference, VoiceMode } from "../lib/storage";

interface SettingsScreenProps {
  settings: AppSettings;
  ready: SessionReady | null;
  health: HealthResponse | null;
  capabilities: CapabilitiesResponse | null;
  memory: MemoryView | null;
  apiBase: string;
  onChange: (patch: Partial<AppSettings>) => void;
  onResetMemory: () => Promise<void>;
}

const INPUT_MODES: Array<{ value: InputPreference; label: string; detail: string }> = [
  { value: "auto", label: "Automatic", detail: "Server speech recognition when configured, otherwise the device recognizer, otherwise typed input." },
  { value: "device", label: "This device", detail: "On-device recognition for instant partials. Audio is still streamed to the service." },
  { value: "server", label: "Service", detail: "Whisper or your own HTTP STT provider transcribes the streamed microphone." },
  { value: "typed", label: "Typed only", detail: "Use the text field on the live screen. Microphone audio still streams for VAD and learning." },
];

const VOICE_MODES: Array<{ value: VoiceMode; label: string; detail: string }> = [
  { value: "client", label: "Device voice", detail: "The browser/OS speaks the translation instantly — no extra round trip." },
  { value: "server", label: "Service voice", detail: "Stream PCM from the server (Piper or bundled formant voice) for a consistent timbre." },
];

export function SettingsScreen({
  settings,
  ready,
  health,
  capabilities,
  memory,
  apiBase,
  onChange,
  onResetMemory,
}: SettingsScreenProps) {
  return (
    <div className="settings-screen">
      <header className="screen-header">
        <div>
          <span className="screen-header__eyebrow"><Icon name="settings" /> Configuration</span>
          <h1>Device settings</h1>
          <p>Routing, voices and the latency contract for this device.</p>
        </div>
      </header>

      <section className="settings-card">
        <h2>Voice output</h2>
        <div className="option-grid">
          {VOICE_MODES.map((option) => (
            <label key={option.value} className={`option ${settings.ttsMode === option.value ? "is-selected" : ""}`}>
              <input
                type="radio"
                name="ttsMode"
                value={option.value}
                checked={settings.ttsMode === option.value}
                onChange={() => onChange({ ttsMode: option.value })}
              />
              <strong>{option.label}</strong>
              <span>{option.detail}</span>
            </label>
          ))}
        </div>
        <label className="toggle toggle--row">
          <input
            type="checkbox"
            checked={settings.autoSpeak}
            onChange={(event) => onChange({ autoSpeak: event.target.checked })}
          />
          <span>
            <strong>Speak translations automatically</strong>
            <span className="toggle__detail">Disable to read only and replay on demand.</span>
          </span>
        </label>
      </section>

      <section className="settings-card">
        <h2>Speech input</h2>
        <div className="option-grid option-grid--two">
          {INPUT_MODES.map((option) => (
            <label key={option.value} className={`option ${settings.inputMode === option.value ? "is-selected" : ""}`}>
              <input
                type="radio"
                name="inputMode"
                value={option.value}
                checked={settings.inputMode === option.value}
                onChange={() => onChange({ inputMode: option.value })}
              />
              <strong>{option.label}</strong>
              <span>{option.detail}</span>
              {option.value === "server" && ready?.engines.speechToText === "none" ? (
                <em className="option__warning">No server STT engine configured</em>
              ) : null}
            </label>
          ))}
        </div>
      </section>

      <section className="settings-card">
        <h2>Service</h2>
        <dl className="settings-rows">
          <div><dt>Endpoint</dt><dd>{apiBase}</dd></div>
          <div><dt>Status</dt><dd>{health ? `${health.status} · v${health.version}` : "unreachable"}</dd></div>
          <div><dt>Translation</dt><dd>{health?.engines.translation ?? "—"}</dd></div>
          <div><dt>Speech to text</dt><dd>{health?.engines.speechToText ?? "—"}</dd></div>
          <div><dt>Text to speech</dt><dd>{health?.engines.textToSpeech ?? "—"}</dd></div>
          <div><dt>Sample rate</dt><dd>{ready?.sampleRate ?? 16000} Hz · PCM16 mono</dd></div>
          <div><dt>Memory version</dt><dd>{memory?.version ?? ready?.memory.version ?? "—"}</dd></div>
        </dl>
      </section>

      <section className="settings-card">
        <h2>Latency contract</h2>
        <dl className="settings-rows">
          <div><dt>End-to-end budget</dt><dd>{ready?.budget.endToEndMs ?? 100} ms (p95)</dd></div>
          <div><dt>Fast path target</dt><dd>{ready?.budget.fastPathMs ?? 5} ms (cache / known phrase)</dd></div>
          <div><dt>Audio frame</dt><dd>{ready?.budget.frameMs ?? 20} ms</dd></div>
        </dl>
        <p className="settings-note">
          Neural inference cannot run in 5 ms on a CPU. The pipeline therefore keeps a versioned translation cache and
          seeded/learned phrase memory in front of every model, streams partial transcripts, and runs TTS in parallel
          with display. Use the live telemetry to see p95 against the contract.
        </p>
      </section>

      <section className="settings-card settings-card--danger">
        <h2>Reset learned memory</h2>
        <p>
          Deletes uploaded phrase pairs, glossary terms and hotwords for the <strong>{memory?.profile ?? "default"}</strong>{' '}
          profile. The seeded offline phrasebook stays available.
        </p>
        <button
          type="button"
          className="danger-button"
          onClick={() => {
            if (window.confirm("Delete everything this device has learned for this profile?")) void onResetMemory();
          }}
        >
          Reset memory
        </button>
        <p className="settings-note">
          Capabilities: {capabilities ? JSON.stringify(capabilities.engines) : "—"}
        </p>
      </section>
    </div>
  );
}
