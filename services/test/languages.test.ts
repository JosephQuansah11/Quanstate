import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LANGUAGE_PAIR,
  LANGUAGES,
  getLanguage,
  languagePairIsValid,
  matchVoice,
  requireLanguage,
  sameLanguage,
} from "../src/languages";

interface PythonCatalogue {
  version: number;
  defaults: { source: string; target: string };
  languages: Array<{
    code: string;
    name: string;
    nativeName: string;
    bcp47: string;
    direction: "ltr" | "rtl";
    whisper: string;
    piper: string | null;
  }>;
}

const cataloguePath = resolve(__dirname, "../../api/quanstate/data/languages.json");
const catalogue = JSON.parse(readFileSync(cataloguePath, "utf8")) as PythonCatalogue;

describe("language catalogue", () => {
  it("matches the Python service catalogue exactly", () => {
    expect(catalogue.languages.map((language) => language.code)).toEqual(LANGUAGES.map((language) => language.code));
    const clientView = catalogue.languages.map((language) => ({
      code: language.code,
      name: language.name,
      nativeName: language.nativeName,
      bcp47: language.bcp47,
      direction: language.direction,
      whisper: language.whisper,
      piper: language.piper,
    }));
    expect(clientView).toEqual(
      LANGUAGES.map((language) => ({
        code: language.code,
        name: language.name,
        nativeName: language.nativeName,
        bcp47: language.bcp47,
        direction: language.direction,
        whisper: language.whisper,
        piper: language.piper,
      })),
    );
    expect({ source: catalogue.defaults.source, target: catalogue.defaults.target }).toEqual(DEFAULT_LANGUAGE_PAIR);
  });

  it("normalises regional and underscored codes", () => {
    expect(requireLanguage("es_MX").code).toBe("es");
    expect(getLanguage("pt-BR")?.name).toBe("Portuguese");
    expect(getLanguage("tlh")).toBeUndefined();
    expect(sameLanguage("en-US", "en-GB")).toBe(true);
  });

  it("rejects unknown or identical pairs", () => {
    expect(languagePairIsValid("en", "es")).toBe(true);
    expect(languagePairIsValid("en", "en")).toBe(false);
    expect(languagePairIsValid("en", "xx")).toBe(false);
    expect(() => requireLanguage("xx")).toThrow(/Unsupported language/);
  });

  it("matches the best platform voice", () => {
    const voices = [
      { lang: "fr-FR", name: "Thomas" },
      { lang: "es-MX", name: "Paulina" },
      { lang: "en-US", name: "Samantha" },
    ];
    expect(matchVoice("es", voices)?.name).toBe("Paulina");
    expect(matchVoice("en-GB", voices)?.name).toBe("Samantha");
    expect(matchVoice("ja-JP", voices)).toBeUndefined();
  });

  it("flags right-to-left languages", () => {
    expect(requireLanguage("ar").direction).toBe("rtl");
  });
});
