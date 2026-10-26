import { getLanguage } from "@quanstate/services";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useCallback, useState } from "react";

interface RecognitionOptions {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

/**
 * On-device speech recognition for iOS and Android.
 *
 * Native recognizers give partial transcripts with no network hop; the final
 * text enters the shared realtime session, so translation memory, glossary and
 * voice output are identical to the web client.  Raw PCM streaming is available
 * to native clients through `MicrophoneStream` when a platform capture module is
 * plugged in (see docs/ARCHITECTURE.md).
 */
export function useDeviceRecognition({ onPartial, onFinal, onError }: RecognitionOptions) {
  const [listening, setListening] = useState(false);

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results?.[0]?.transcript?.trim();
    if (!text) return;
    if (event.isFinal) {
      onFinal(text);
    } else {
      onPartial(text);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    onError(event.message ?? `Speech recognition error: ${event.error}`);
    setListening(false);
  });

  useSpeechRecognitionEvent("end", () => {
    setListening(false);
  });

  const start = useCallback(
    async (language: string) => {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        onError("Microphone and speech recognition permissions are required");
        return false;
      }
      ExpoSpeechRecognitionModule.start({
        lang: getLanguage(language)?.bcp47 ?? language,
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        requiresOnDeviceRecognition: false,
      });
      setListening(true);
      return true;
    },
    [onError],
  );

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setListening(false);
  }, []);

  return { listening, start, stop };
}
