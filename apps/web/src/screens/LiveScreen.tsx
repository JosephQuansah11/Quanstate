import type { MemoryView } from "@quanstate/services";
import { getLanguage } from "@quanstate/services";
import { useMemo, useState, type FormEvent } from "react";

import { Icon } from "../components/Icon";
import { LatencyHud } from "../components/LatencyHud";
import type { useTranslator } from "../hooks/useTranslator";

interface LiveScreenProps {
  translator: ReturnType<typeof useTranslator>;
  sourceLang: string;
  targetLang: string;
  online: boolean;
  memory: MemoryView | null;
  autoSpeak: boolean;
  apiBase: string;
  onToggleAutoSpeak: (enabled: boolean) => void;
  onOpenPair: () => void;
  onOpenLearn: () => void;
}

export function LiveScreen({
  translator,
  sourceLang,
  targetLang,
  online,
  memory,
  autoSpeak,
  apiBase,
  onToggleAutoSpeak,
  onOpenPair,
  onOpenLearn,
}: LiveScreenProps) {
  const [draft, setDraft] = useState("");
  const source = getLanguage(sourceLang);
  const target = getLanguage(targetLang);
  const latest = translator.entries[0];

  const statusLabel = useMemo(() => {
    if (!online) return "Service offline";
    switch (translator.status) {
      case "open":
        return translator.recording ? "Listening" : "Ready";
      case "connecting":
        return "Connecting";
      case "reconnecting":
        return "Reconnecting";
      case "closed":
        return "Disconnected";
      default:
        return "Idle";
    }
  }, [online, translator.recording, translator.status]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await translator.sendText(text);
  };

  return (
    <div className="live-screen">
      <div className="live-main">
        <header className="live-header">
          <button type="button" className="pair-pill" onClick={onOpenPair} title="Change language pair for iOS/Android/web">
            <span dir={source?.direction}>{source?.nativeName}</span>
            <Icon name="arrow" />
            <span dir={target?.direction}>{target?.nativeName}</span>
          </button>
          <div className="live-header__meta">
            <span className={`status-chip ${translator.status === "open" ? "is-good" : "is-warn"}`}>
              <span className="status-dot" />
              {statusLabel}
            </span>
            <label className="toggle">
              <input type="checkbox" checked={autoSpeak} onChange={(event) => onToggleAutoSpeak(event.target.checked)} />
              <span>Speak</span>
            </label>
          </div>
        </header>

        {translator.error ? (
          <div className="banner banner--error" role="alert">
            <strong>Session problem</strong>
            <span>{translator.error}</span>
            <button type="button" onClick={() => translator.setError(null)} aria-label="Dismiss">
              <Icon name="close" />
            </button>
          </div>
        ) : null}

        <section className="stage" aria-live="polite">
          <div className="stage__source">
            <span className="stage__eyebrow">{source?.name} · {source?.code.toUpperCase()}</span>
            <p className="stage__text" dir={source?.direction}>
              {translator.partial || latest?.sourceText || "Tap the microphone and start speaking."}
            </p>
            {!translator.partial && !latest ? (
              <p className="stage__hint">
                {translator.ready?.engines.speechToText === "none"
                  ? "Server speech recognition is not configured — this build uses your device's recognizer or typed input, and still streams mic audio to the pipeline."
                  : "Speech is transcribed on the service and translated in the same pass."}
              </p>
            ) : null}
          </div>

          <div className="stage__divider">
            <span />
            <Icon name="translate" />
            <span />
          </div>

          <div className="stage__target">
            <span className="stage__eyebrow">{target?.name} · {target?.code.toUpperCase()}</span>
            <p className="stage__text stage__text--target" dir={target?.direction}>
              {latest?.targetText ?? "Translation appears here in real time."}
            </p>
            <div className="stage__actions">
              {latest ? (
                <>
                  <button type="button" className="ghost-button" onClick={() => translator.speak(latest.targetText)}>
                    <Icon name="play" />
                    Speak
                  </button>
                  <span className={`tag ${latest.cached ? "tag--cached" : ""}`}>
                    {latest.cached ? <><Icon name="bolt" /> cached</> : latest.latency ? `${Math.round(latest.latency.endToEndMs)} ms` : "live"}
                  </span>
                  {latest.glossaryHits.slice(0, 3).map((term) => (
                    <span className="tag tag--glossary" key={term}>{term}</span>
                  ))}
                  <span className="tag">confidence {Math.round(latest.confidence * 100)}%</span>
                </>
              ) : null}
            </div>
          </div>
        </section>

        <section className="controls">
          <button
            type="button"
            className={`mic ${translator.recording ? "is-recording" : ""}`}
            onClick={() => (translator.recording ? translator.stopListening() : void translator.startListening())}
            aria-pressed={translator.recording}
            aria-label={translator.recording ? "Stop listening" : "Start listening"}
            style={{ ["--level" as string]: Math.min(1, translator.level * 14) }}
          >
            <span className="mic__pulse" />
            <span className="mic__pulse mic__pulse--delayed" />
            <span className="mic__core">
              <Icon name={translator.recording ? "stop" : "mic"} />
            </span>
          </button>
          <div className="controls__text">
            <strong>{translator.recording ? "Listening… tap to stop" : "Tap to speak"}</strong>
            <span>
              {translator.ready?.engines.speechToText === "none"
                ? "On-device recognition feeds the same translation memory"
                : `${translator.ready?.engines.speechToText ?? "speech"} · ${translator.ready?.engines.translation ?? "translation"}`}
            </span>
          </div>

          <form className="type-form" onSubmit={submit}>
            <Icon name="wave" />
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={`Type in ${source?.name ?? "your language"}…`}
              aria-label="Type text to translate"
            />
            <button type="submit" className="ghost-button" disabled={!draft.trim()}>
              Translate
              <Icon name="arrow" />
            </button>
          </form>
        </section>

        <section className="conversation">
          <header className="conversation__header">
            <h2>Session transcript</h2>
            <button type="button" className="link-button" onClick={translator.clear} disabled={translator.entries.length === 0}>
              Clear
            </button>
          </header>
          {translator.entries.length === 0 ? (
            <p className="conversation__empty">
              Nothing yet. Try “Where is the train station?” and watch the translation land in milliseconds — then
              upload a glossary to make it yours.
            </p>
          ) : (
            <ol className="conversation__list">
              {translator.entries.map((entry) => (
                <li key={entry.id}>
                  <div className="conversation__source">
                    <span dir={source?.direction}>{entry.sourceText}</span>
                    <time>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                  </div>
                  <div className="conversation__target" dir={target?.direction}>
                    {entry.targetText}
                  </div>
                  <div className="conversation__meta">
                    <button type="button" className="icon-button" onClick={() => translator.speak(entry.targetText)} aria-label="Replay translation">
                      <Icon name="play" />
                    </button>
                    <span>{entry.latency ? `${Math.round(entry.latency.endToEndMs)} ms` : "—"}</span>
                    {entry.cached ? <span className="tag tag--cached"><Icon name="bolt" /> cached</span> : null}
                    {entry.glossaryHits.length ? <span className="tag tag--glossary">{entry.glossaryHits.length} glossary</span> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="live-footer">
          <span>Device · {apiBase.replace(/^https?:\/\//, "")}</span>
          <button type="button" className="link-button" onClick={onOpenLearn}>
            <Icon name="learn" /> Teach your device
          </button>
        </footer>
      </div>

      <LatencyHud stats={translator.stats} ready={translator.ready} memory={memory} online={online} />
    </div>
  );
}
