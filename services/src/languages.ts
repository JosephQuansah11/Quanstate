/**
 * Language catalogue shared by every Quanstate client.
 *
 * The canonical copy lives in `api/quanstate/data/languages.json`; a parity test
 * (`test/languages.test.ts`) fails if the two drift, so the web, iOS and Android
 * builds always offer exactly the languages the service understands.
 */

export type Direction = "ltr" | "rtl";

export interface Language {
  readonly code: string;
  readonly name: string;
  readonly nativeName: string;
  readonly bcp47: string;
  readonly direction: Direction;
  readonly whisper: string;
  readonly piper: string | null;
}

type Row = readonly [
  code: string,
  name: string,
  nativeName: string,
  bcp47: string,
  direction: Direction,
  whisper: string,
  piper: string | null,
];

const ROWS: readonly Row[] = [
  ["en", "English", "English", "en-US", "ltr", "en", "en_US-amy-medium"],
  ["es", "Spanish", "Español", "es-ES", "ltr", "es", "es_ES-davefx-medium"],
  ["fr", "French", "Français", "fr-FR", "ltr", "fr", "fr_FR-siwis-medium"],
  ["de", "German", "Deutsch", "de-DE", "ltr", "de", "de_DE-thorsten-medium"],
  ["pt", "Portuguese", "Português", "pt-BR", "ltr", "pt", "pt_BR-faber-medium"],
  ["it", "Italian", "Italiano", "it-IT", "ltr", "it", "it_IT-riccardo-x_low"],
  ["nl", "Dutch", "Nederlands", "nl-NL", "ltr", "nl", "nl_NL-mls-medium"],
  ["pl", "Polish", "Polski", "pl-PL", "ltr", "pl", "pl_PL-darkman-medium"],
  ["tr", "Turkish", "Türkçe", "tr-TR", "ltr", "tr", "tr_TR-dfki-medium"],
  ["ru", "Russian", "Русский", "ru-RU", "ltr", "ru", "ru_RU-dmitri-medium"],
  ["uk", "Ukrainian", "Українська", "uk-UA", "ltr", "uk", "uk_UA-ukrainian_tts-medium"],
  ["ar", "Arabic", "العربية", "ar-SA", "rtl", "ar", null],
  ["hi", "Hindi", "हिन्दी", "hi-IN", "ltr", "hi", null],
  ["bn", "Bengali", "বাংলা", "bn-BD", "ltr", "bn", null],
  ["zh", "Chinese", "中文", "zh-CN", "ltr", "zh", null],
  ["ja", "Japanese", "日本語", "ja-JP", "ltr", "ja", null],
  ["ko", "Korean", "한국어", "ko-KR", "ltr", "ko", null],
  ["vi", "Vietnamese", "Tiếng Việt", "vi-VN", "ltr", "vi", null],
  ["th", "Thai", "ไทย", "th-TH", "ltr", "th", null],
  ["id", "Indonesian", "Bahasa Indonesia", "id-ID", "ltr", "id", null],
  ["sw", "Swahili", "Kiswahili", "sw-KE", "ltr", "sw", null],
];

export const LANGUAGES: readonly Language[] = ROWS.map(
  ([code, name, nativeName, bcp47, direction, whisper, piper]) => ({
    code,
    name,
    nativeName,
    bcp47,
    direction,
    whisper,
    piper,
  }),
);

export const DEFAULT_LANGUAGE_PAIR = { source: "en", target: "es" } as const;
export const DEFAULT_SAMPLE_RATE = 16_000;

const BY_CODE = new Map<string, Language>(LANGUAGES.map((language) => [language.code, language]));

export function normalizeLanguageCode(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

export function getLanguage(code: string): Language | undefined {
  return BY_CODE.get(normalizeLanguageCode(code));
}

export function requireLanguage(code: string): Language {
  const language = getLanguage(code);
  if (!language) {
    throw new Error(`Unsupported language: ${code}`);
  }
  return language;
}

export function isSupportedLanguage(code: string): boolean {
  return BY_CODE.has(normalizeLanguageCode(code));
}

export function sameLanguage(a: string, b: string): boolean {
  return normalizeLanguageCode(a) === normalizeLanguageCode(b);
}

/** Pick the closest platform voice (Web Speech / iOS AVSpeech / Android TTS). */
export function matchVoice(
  code: string,
  voices: readonly { lang: string; name?: string }[],
): { lang: string; name?: string } | undefined {
  const base = normalizeLanguageCode(code);
  const exact = voices.find((voice) => normalizeLanguageCode(voice.lang) === base);
  if (exact) return exact;
  const language = getLanguage(code);
  if (!language) return undefined;
  return voices.find((voice) => voice.lang.toLowerCase().startsWith(language.bcp47.toLowerCase()));
}

export function languagePairIsValid(source: string, target: string): boolean {
  return isSupportedLanguage(source) && isSupportedLanguage(target) && !sameLanguage(source, target);
}
