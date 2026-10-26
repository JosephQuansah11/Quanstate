import type { MemoryView, SessionReady } from "@quanstate/services";

import type { LiveStats } from "../hooks/useTranslator";
import { Icon } from "./Icon";

interface LatencyHudProps {
  stats: LiveStats;
  ready: SessionReady | null;
  memory: MemoryView | null;
  online: boolean;
}

function metric(value: number, unit = "ms"): string {
  if (!Number.isFinite(value) || value === 0) return "—";
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${unit}`;
}

export function LatencyHud({ stats, ready, memory, online }: LatencyHudProps) {
  const budget = ready?.budget.endToEndMs ?? 100;
  const fastPath = ready?.budget.fastPathMs ?? 5;
  const usage = Math.min(100, (stats.p95 / budget) * 100);

  return (
    <aside className="hud" aria-label="Session telemetry">
      <section className="hud__card hud__card--latency">
        <header className="hud__header">
          <h2>Latency</h2>
          <span className={`status-chip ${stats.withinBudget ? "is-good" : "is-warn"}`}>
            <span className="status-dot" />
            {stats.withinBudget ? `p95 under ${budget} ms` : "over budget"}
          </span>
        </header>
        <div className="hud__metrics">
          <div className="hud__metric">
            <span className="hud__metric-label">p50</span>
            <strong>{metric(stats.p50)}</strong>
          </div>
          <div className="hud__metric">
            <span className="hud__metric-label">p95</span>
            <strong>{metric(stats.p95)}</strong>
          </div>
          <div className="hud__metric">
            <span className="hud__metric-label">max</span>
            <strong>{metric(stats.max)}</strong>
          </div>
        </div>
        <div className="hud__bar" role="img" aria-label={`p95 ${metric(stats.p95)} of ${budget} ms budget`}>
          <span style={{ width: `${usage}%` }} className={stats.withinBudget ? "is-good" : "is-warn"} />
          <i style={{ left: `${Math.min(100, (fastPath / budget) * 100)}%` }} title={`Fast path target ${fastPath} ms`} />
        </div>
        <dl className="hud__rows">
          <div><dt>Fast path</dt><dd>{metric(fastPath)} target</dd></div>
          <div><dt>Cache hits</dt><dd>{Math.round(stats.cacheHitRate * 100)}%</dd></div>
          <div><dt>Round trip</dt><dd>{stats.rttMs ? `${stats.rttMs} ms` : "—"}</dd></div>
          <div><dt>Utterances</dt><dd>{stats.translations}</dd></div>
          <div><dt>Dropped audio</dt><dd>{stats.droppedFrames}</dd></div>
        </dl>
        <p className="hud__note">
          End-to-end is measured from end-of-speech to translated text. Cached and known phrases answer in well under
          5 ms; first-time neural inference is what the 100 ms budget covers.
        </p>
      </section>

      <section className="hud__card">
        <header className="hud__header">
          <h2>Engines</h2>
          <span className={`status-chip ${online ? "is-good" : "is-warn"}`}>
            <span className="status-dot" />
            {online ? "service online" : "offline"}
          </span>
        </header>
        <dl className="hud__rows">
          <div><dt>Translation</dt><dd>{ready?.engines.translation ?? "—"}</dd></div>
          <div><dt>Speech in</dt><dd>{ready?.engines.speechToText ?? "—"}</dd></div>
          <div><dt>Voice out</dt><dd>{ready?.engines.textToSpeech ?? "—"}</dd></div>
          <div><dt>TTS route</dt><dd>{ready?.ttsMode === "server" ? "server stream" : "device voice"}</dd></div>
        </dl>
        {ready?.engines.speechToText === "none" ? (
          <p className="hud__note">
            Server STT is idle. The device is using on-device recognition (or typed input) and still streams the
            microphone for VAD, learning and latency telemetry. Set <code>QUANSTATE_STT=faster-whisper</code> to run
            speech recognition in the service.
          </p>
        ) : null}
      </section>

      <section className="hud__card">
        <header className="hud__header">
          <h2>Learned memory</h2>
          <Icon name="book" />
        </header>
        <div className="hud__memory">
          <div><strong>{memory?.stats.phrases ?? ready?.memory.phrases ?? 0}</strong><span>phrases</span></div>
          <div><strong>{memory?.stats.glossary ?? ready?.memory.glossary ?? 0}</strong><span>glossary</span></div>
          <div><strong>{memory?.stats.documents ?? ready?.memory.documents ?? 0}</strong><span>uploads</span></div>
          <div><strong>{memory?.stats.hotwords ?? ready?.memory.hotwords ?? 0}</strong><span>hotwords</span></div>
        </div>
        <p className="hud__note">
          Upload documents or paste a YouTube URL to add phrase pairs, terminology and pronunciation hotwords. New
          material invalidates the translation cache instantly.
        </p>
      </section>
    </aside>
  );
}
