import { LANGUAGES, type Language } from "@quanstate/services";
import { useMemo, useState } from "react";

import { Icon } from "./Icon";

interface LanguageFieldProps {
  label: string;
  hint: string;
  value: string;
  exclude: string;
  onChange: (code: string) => void;
  autoOpen?: boolean;
}

export function LanguageField({ label, hint, value, exclude, onChange, autoOpen = false }: LanguageFieldProps) {
  const [open, setOpen] = useState(autoOpen);
  const [query, setQuery] = useState("");
  const selected = LANGUAGES.find((language) => language.code === value) ?? LANGUAGES[0]!;

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return LANGUAGES.filter((language) => language.code !== exclude).filter((language) =>
      !needle ||
      language.name.toLowerCase().includes(needle) ||
      language.nativeName.toLowerCase().includes(needle) ||
      language.code.includes(needle),
    );
  }, [query, exclude]);

  const choose = (language: Language) => {
    onChange(language.code);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className={`language-field${open ? " is-open" : ""}`}>
      <button type="button" className="language-field__trigger" onClick={() => setOpen((next) => !next)}>
        <span className="language-field__label">{label}</span>
        <span className="language-field__value">
          <span className="language-field__native" dir={selected.direction}>
            {selected.nativeName}
          </span>
          <span className="language-field__meta">
            {selected.name} · {selected.code.toUpperCase()}
          </span>
        </span>
        <span className="language-field__hint">{hint}</span>
        <Icon name="chevron" className="language-field__chevron" />
      </button>

      {open ? (
        <div className="language-field__panel">
          <div className="language-field__search">
            <Icon name="search" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search languages"
              aria-label={`Search ${label.toLowerCase()} language`}
            />
          </div>
          <ul className="language-field__list" role="listbox" aria-label={label}>
            {results.map((language) => (
              <li key={language.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={language.code === value}
                  className={language.code === value ? "is-selected" : ""}
                  onClick={() => choose(language)}
                >
                  <span className="language-field__option-native" dir={language.direction}>
                    {language.nativeName}
                  </span>
                  <span className="language-field__option-name">{language.name}</span>
                  {language.code === value ? <Icon name="check" /> : null}
                </button>
              </li>
            ))}
            {results.length === 0 ? <li className="language-field__empty">No matching language</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
