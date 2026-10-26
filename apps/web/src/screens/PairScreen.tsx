import { useState } from "react";

import { LanguageField } from "../components/LanguageField";
import { Icon } from "../components/Icon";

interface PairScreenProps {
  sourceLang: string;
  targetLang: string;
  firstRun: boolean;
  onSelect: (pair: { sourceLang: string; targetLang: string }) => void;
  onStart?: () => void;
}

/**
 * First screen of the device: pick the language you speak and the language you
 * want to hear.  Also reachable any time from the header to change the pair.
 */
export function PairScreen({ sourceLang, targetLang, firstRun, onSelect, onStart }: PairScreenProps) {
  const [draftSource, setDraftSource] = useState(sourceLang);
  const [draftTarget, setDraftTarget] = useState(targetLang);

  const swap = () => {
    setDraftSource(draftTarget);
    setDraftTarget(draftSource);
  };

  const start = () => {
    onSelect({ sourceLang: draftSource, targetLang: draftTarget });
    onStart?.();
  };

  return (
    <div className="pair-screen">
      <div className="pair-screen__glow" aria-hidden="true" />
      <header className="pair-screen__header">
        <div className="brand">
          <span className="brand__mark">
            <Icon name="waveform" />
          </span>
          <span className="brand__name">Quanstate</span>
        </div>
        <p className="pair-screen__tagline">
          A pocket interpreter that keeps learning — from conversations, documents and the videos you feed it.
        </p>
      </header>

      <main className="pair-screen__card">
        <div className="pair-screen__eyebrow">
          <Icon name="globe" />
          <span>{firstRun ? "Set up your device" : "Change language pair"}</span>
        </div>
        <h1>{firstRun ? "Which languages are you speaking?" : "Language pair"}</h1>
        <p className="pair-screen__subtitle">
          Choose the language you speak and the language you want in your ear. You can flip them at any time.
        </p>

        <div className="pair-screen__fields">
          <LanguageField
            label="I speak"
            hint="Original language"
            value={draftSource}
            exclude={draftTarget}
            onChange={setDraftSource}
            autoOpen={firstRun}
          />
          <button type="button" className="swap-button" onClick={swap} aria-label="Swap languages">
            <Icon name="swap" />
          </button>
          <LanguageField
            label="Translate into"
            hint="Translation language"
            value={draftTarget}
            exclude={draftSource}
            onChange={setDraftTarget}
          />
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={start}
          disabled={draftSource === draftTarget}
        >
          {firstRun ? "Start translating" : "Apply pair"}
          <Icon name="arrow" />
        </button>

        <p className="pair-screen__footnote">
          Audio stays on the wire as 16 kHz PCM and is translated on the server, with the voice spoken locally by your
          device for near-zero delay.
        </p>
      </main>
    </div>
  );
}
