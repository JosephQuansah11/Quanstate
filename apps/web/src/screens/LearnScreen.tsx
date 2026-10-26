import type { MemoryView, TranslationDevice } from "@quanstate/services";
import { useRef, useState } from "react";

import { Icon } from "../components/Icon";

interface LearnScreenProps {
  device: TranslationDevice;
  sourceLang: string;
  targetLang: string;
  memory: MemoryView | null;
  onRefresh: () => Promise<void>;
}

export function LearnScreen({ device, sourceLang, targetLang, memory, onRefresh }: LearnScreenProps) {
  const [youtube, setYoutube] = useState("");
  const [glossary, setGlossary] = useState("Quanstate = Quanstate\ntranslation memory = memoria de traducción\nspeech to text = voz a texto");
  const [busy, setBusy] = useState<"youtube" | "document" | "glossary" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const wrap = async (task: () => Promise<string>, kind: typeof busy) => {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      const result = await task();
      setMessage(result);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Learning failed");
    } finally {
      setBusy(null);
    }
  };

  const learnYoutube = () =>
    wrap(async () => {
      if (!youtube.trim()) throw new Error("Paste a YouTube URL first");
      const result = await device.learnYouTube(youtube.trim());
      setYoutube("");
      return `Learned ${result.document.segments ?? result.document.sentences} caption lines — ${result.memory.stats.phrases} phrases, ${result.memory.stats.glossary} glossary terms now active.`;
    }, "youtube");

  const learnDocument = (file: File) =>
    wrap(async () => {
      if (file.size > 20 * 1024 * 1024) throw new Error("Documents are limited to 20 MB");
      const result = await device.learnDocument(file, file.name, file.name);
      return `${file.name}: ${result.document.phrasesAdded} phrase pairs, ${result.document.glossaryAdded} glossary terms, ${result.document.hotwordsAdded} hotwords.`;
    }, "document");

  const learnGlossary = () =>
    wrap(async () => {
      const result = await device.learnText(glossary, "glossary.txt", "Pasted glossary");
      return `Imported ${result.document.phrasesAdded} pairs from your glossary.`;
    }, "glossary");

  return (
    <div className="learn-screen">
      <header className="screen-header">
        <div>
          <span className="screen-header__eyebrow"><Icon name="learn" /> Teaching</span>
          <h1>Teach your device</h1>
          <p>
            Every upload becomes translation memory: parallel phrases, protected terminology, speech-recognition
            hotwords and pronunciation hints. Nothing is retrained, so it takes effect on the next sentence.
          </p>
        </div>
        <div className="learn-pair">
          <span>{sourceLang.toUpperCase()}</span>
          <Icon name="arrow" />
          <span>{targetLang.toUpperCase()}</span>
        </div>
      </header>

      {message ? <div className="banner banner--ok"><Icon name="check" /><span>{message}</span></div> : null}
      {error ? <div className="banner banner--error"><strong>Could not learn</strong><span>{error}</span></div> : null}

      <div className="learn-grid">
        <section className="learn-card">
          <header>
            <span className="learn-card__icon"><Icon name="play" /></span>
            <div>
              <h2>YouTube video</h2>
              <p>Pull the caption track and the auto-translated track to build a parallel corpus.</p>
            </div>
          </header>
          <div className="learn-card__row">
            <input
              value={youtube}
              onChange={(event) => setYoutube(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              inputMode="url"
              aria-label="YouTube URL"
            />
            <button type="button" className="primary-button primary-button--small" onClick={learnYoutube} disabled={busy !== null}>
              {busy === "youtube" ? "Learning…" : "Learn"}
            </button>
          </div>
          <p className="learn-card__hint">
            The service fetches captions directly — no API key. If the video has a translated track, every cue becomes
            a phrase pair.
          </p>
        </section>

        <section className="learn-card">
          <header>
            <span className="learn-card__icon"><Icon name="book" /></span>
            <div>
              <h2>Documents</h2>
              <p>Glossaries, transcripts, subtitles, contracts — .txt, .md, .srt, .vtt, .json, .csv, .docx, .pdf.</p>
            </div>
          </header>
          <div className="dropzone" onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && fileRef.current?.click()}>
            <Icon name="learn" />
            <strong>{busy === "document" ? "Extracting phrasing…" : "Choose a document"}</strong>
            <span>20 MB max · processed on the service</span>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.srt,.vtt,.csv,.tsv,.json,.html,.htm,.docx,.pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void learnDocument(file);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </section>

        <section className="learn-card learn-card--wide">
          <header>
            <span className="learn-card__icon"><Icon name="translate" /></span>
            <div>
              <h2>Paste a glossary</h2>
              <p>One pair per line, separated by <code>=</code>, <code>|</code> or a tab.</p>
            </div>
          </header>
          <textarea value={glossary} onChange={(event) => setGlossary(event.target.value)} rows={6} spellCheck={false} />
          <button type="button" className="primary-button primary-button--small" onClick={learnGlossary} disabled={busy !== null}>
            {busy === "glossary" ? "Importing…" : "Import glossary"}
          </button>
        </section>
      </div>

      <section className="memory-panel">
        <header className="memory-panel__header">
          <h2>Translation memory</h2>
          <span>profile · {memory?.profile ?? "default"}</span>
        </header>
        <div className="memory-panel__stats">
          <div><strong>{memory?.stats.phrases ?? 0}</strong><span>phrases</span></div>
          <div><strong>{memory?.stats.learnedPhrases ?? 0}</strong><span>from uploads</span></div>
          <div><strong>{memory?.stats.glossary ?? 0}</strong><span>protected terms</span></div>
          <div><strong>{memory?.stats.hotwords ?? 0}</strong><span>speech hotwords</span></div>
          <div><strong>{memory?.stats.documents ?? 0}</strong><span>documents</span></div>
        </div>

        {memory?.glossary.length ? (
          <div className="memory-panel__terms">
            {memory.glossary.slice(0, 24).map((term) => (
              <span key={`${term.source}-${term.target}`} className="tag tag--glossary">
                {term.source} → {term.target}
              </span>
            ))}
          </div>
        ) : null}

        <ul className="document-list">
          {(memory?.documents ?? []).map((document) => (
            <li key={document.id}>
              <span className="document-list__icon"><Icon name={document.kind === "youtube" ? "play" : "book"} /></span>
              <div>
                <strong>{document.title}</strong>
                <span>
                  {document.kind} · {document.phrasesAdded} pairs · {document.glossaryAdded} terms · {document.hotwordsAdded} hotwords
                </span>
              </div>
              <time>{new Date(document.createdAt * 1000).toLocaleDateString()}</time>
            </li>
          ))}
          {!memory?.documents.length ? <li className="document-list__empty">Nothing learned yet — upload something above.</li> : null}
        </ul>
      </section>
    </div>
  );
}
