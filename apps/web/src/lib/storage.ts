import { DEFAULT_LANGUAGE_PAIR, isSupportedLanguage, sameLanguage } from "@quanstate/services";

export type VoiceMode = "client" | "server";
export type InputPreference = "auto" | "device" | "server" | "typed";

export interface AppSettings {
  sourceLang: string;
  targetLang: string;
  ttsMode: VoiceMode;
  inputMode: InputPreference;
  autoSpeak: boolean;
  paired: boolean;
}

const STORAGE_KEY = "quanstate.settings.v1";

export const defaultSettings: AppSettings = {
  sourceLang: DEFAULT_LANGUAGE_PAIR.source,
  targetLang: DEFAULT_LANGUAGE_PAIR.target,
  ttsMode: "client",
  inputMode: "auto",
  autoSpeak: true,
  paired: false,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const sourceLang = isSupportedLanguage(parsed.sourceLang ?? "") ? parsed.sourceLang! : defaultSettings.sourceLang;
    const targetLang = isSupportedLanguage(parsed.targetLang ?? "") ? parsed.targetLang! : defaultSettings.targetLang;
    return {
      sourceLang,
      targetLang: sameLanguage(sourceLang, targetLang) ? defaultSettings.targetLang : targetLang,
      ttsMode: parsed.ttsMode === "server" ? "server" : "client",
      inputMode: (["auto", "device", "server", "typed"] as const).includes(parsed.inputMode as InputPreference)
        ? (parsed.inputMode as InputPreference)
        : "auto",
      autoSpeak: parsed.autoSpeak !== false,
      paired: parsed.paired === true,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode: settings simply do not persist */
  }
}
