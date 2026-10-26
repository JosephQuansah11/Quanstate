import { getLanguage, type SpeakOptions as ServiceSpeakOptions, type SpeechSink } from "@quanstate/services";
import * as Speech from "expo-speech";

/** Native iOS/Android voice. Speaking locally keeps perceived latency near zero. */
export class ExpoSpeechSink implements SpeechSink {
  readonly available = true;

  speak(text: string, language: string, options: ServiceSpeakOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      const languageInfo = getLanguage(language);
      Speech.speak(text, {
        language: languageInfo?.bcp47 ?? language,
        rate: options.rate ?? 1.0,
        pitch: options.pitch ?? 1.0,
        volume: options.volume ?? 1.0,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    });
  }

  cancel(): void {
    void Speech.stop();
  }
}
