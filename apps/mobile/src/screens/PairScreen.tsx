import { getLanguage } from "@quanstate/services";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { LanguageModal } from "../components/LanguageModal";
import { PrimaryButton } from "../components/Primitives";
import { colors, radius, spacing } from "../theme";

interface PairScreenProps {
  sourceLang: string;
  targetLang: string;
  firstRun: boolean;
  onSelect: (pair: { sourceLang: string; targetLang: string }) => void;
  onStart?: () => void;
  onCancel?: () => void;
}

export function PairScreen({ sourceLang, targetLang, firstRun, onSelect, onStart, onCancel }: PairScreenProps) {
  const [draftSource, setDraftSource] = useState(sourceLang);
  const [draftTarget, setDraftTarget] = useState(targetLang);
  const [picker, setPicker] = useState<"source" | "target" | null>(null);

  const source = getLanguage(draftSource);
  const target = getLanguage(draftTarget);

  const swap = () => {
    setDraftSource(draftTarget);
    setDraftTarget(draftSource);
  };

  const apply = () => {
    onSelect({ sourceLang: draftSource, targetLang: draftTarget });
    onStart?.();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.brandRow}>
        <View style={styles.mark}><Text style={styles.markText}>◍</Text></View>
        <Text style={styles.brand}>Quanstate</Text>
      </View>

      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{firstRun ? "SET UP YOUR DEVICE" : "LANGUAGE PAIR"}</Text>
        <Text style={styles.title}>{firstRun ? "Which languages are you speaking?" : "Change languages"}</Text>
        <Text style={styles.subtitle}>
          Pick the language you speak and the language you want in your ear. You can flip them any time.
        </Text>

        <Pressable style={styles.field} onPress={() => setPicker("source")} accessibilityRole="button">
          <Text style={styles.fieldLabel}>I SPEAK</Text>
          <Text style={styles.fieldNative}>{source?.nativeName ?? draftSource}</Text>
          <Text style={styles.fieldMeta}>{source?.name} · original language</Text>
        </Pressable>

        <Pressable style={styles.swap} onPress={swap} accessibilityRole="button" accessibilityLabel="Swap languages">
          <Text style={styles.swapText}>⇅</Text>
        </Pressable>

        <Pressable style={styles.field} onPress={() => setPicker("target")} accessibilityRole="button">
          <Text style={styles.fieldLabel}>TRANSLATE INTO</Text>
          <Text style={styles.fieldNative}>{target?.nativeName ?? draftTarget}</Text>
          <Text style={styles.fieldMeta}>{target?.name} · translation language</Text>
        </Pressable>

        <PrimaryButton label={firstRun ? "Start translating" : "Apply pair"} onPress={apply} disabled={draftSource === draftTarget} />
        {!firstRun && onCancel ? (
          <Pressable onPress={onCancel} accessibilityRole="button" style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        ) : null}

        <Text style={styles.footnote}>
          Speech is recognized on the device, translated by the Quanstate service and spoken by the native voice —
          typically inside the 100 ms budget once your phrasebook is warm.
        </Text>
      </View>

      <LanguageModal
        visible={picker === "source"}
        title="I speak"
        selected={draftSource}
        exclude={draftTarget}
        onSelect={setDraftSource}
        onClose={() => setPicker(null)}
      />
      <LanguageModal
        visible={picker === "target"}
        title="Translate into"
        selected={draftTarget}
        exclude={draftSource}
        onSelect={setDraftTarget}
        onClose={() => setPicker(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingTop: 64, gap: spacing.lg },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  markText: { color: colors.accentInk, fontSize: 18, fontWeight: "700" },
  brand: { color: colors.ink, fontSize: 19, fontWeight: "700", letterSpacing: -0.4 },
  hero: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  eyebrow: { color: colors.accent, fontSize: 10.5, letterSpacing: 1.8, fontWeight: "700" },
  title: { color: colors.ink, fontSize: 27, fontWeight: "700", letterSpacing: -0.8, lineHeight: 33 },
  subtitle: { color: colors.inkDim, fontSize: 13.5, lineHeight: 20, marginBottom: spacing.sm },
  field: {
    backgroundColor: colors.cardSoft,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 3,
  },
  fieldLabel: { color: colors.inkFaint, fontSize: 10, letterSpacing: 1.2 },
  fieldNative: { color: colors.ink, fontSize: 22, fontWeight: "700" },
  fieldMeta: { color: colors.inkFaint, fontSize: 11.5 },
  swap: {
    alignSelf: "center",
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cardSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  swapText: { color: colors.inkDim, fontSize: 19 },
  cancel: { alignItems: "center", paddingVertical: 8 },
  cancelText: { color: colors.inkFaint, fontSize: 13 },
  footnote: { color: colors.inkFaint, fontSize: 11, lineHeight: 17, marginTop: spacing.sm },
});
