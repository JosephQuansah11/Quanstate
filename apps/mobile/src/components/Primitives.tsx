import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { colors, radius, spacing } from "../theme";

export function Card({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "danger" }) {
  return <View style={[styles.card, tone === "danger" && styles.cardDanger]}>{children}</View>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{children}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.primary, (disabled || busy) && styles.disabled, pressed && styles.pressed]}
    >
      {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

export function GhostButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.ghost, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={styles.ghostText}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ label, tone = "default" }: { label: string; tone?: "default" | "good" | "warn" | "accent" }) {
  return (
    <View style={[styles.pill, tone === "good" && styles.pillGood, tone === "warn" && styles.pillWarn, tone === "accent" && styles.pillAccent]}>
      <Text style={[styles.pillText, tone === "good" && styles.pillGoodText, tone === "warn" && styles.pillWarnText, tone === "accent" && styles.pillAccentText]}>
        {label}
      </Text>
    </View>
  );
}

export function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && styles.statAccent]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.inkFaint}
      {...props}
      style={[styles.field, props.style]}
    />
  );
}

export function Banner({ message, tone }: { message: string; tone: "error" | "ok" }) {
  return (
    <View style={[styles.banner, tone === "error" ? styles.bannerError : styles.bannerOk]}>
      <Text style={[styles.bannerText, tone === "error" ? styles.bannerErrorText : styles.bannerOkText]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardDanger: { borderColor: "rgba(251,113,133,0.35)" },
  sectionTitle: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 },
  sectionTitleText: { color: colors.inkDim, fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: "600" },
  sectionHint: { color: colors.inkFaint, fontSize: 11 },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryText: { color: colors.accentInk, fontWeight: "700", fontSize: 15 },
  ghost: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  ghostText: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.82 },
  pill: { borderColor: colors.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start" },
  pillGood: { borderColor: "rgba(76,224,179,0.35)", backgroundColor: "rgba(76,224,179,0.1)" },
  pillWarn: { borderColor: "rgba(251,191,36,0.35)", backgroundColor: "rgba(251,191,36,0.08)" },
  pillAccent: { borderColor: "rgba(125,211,252,0.35)", backgroundColor: "rgba(125,211,252,0.08)" },
  pillText: { color: colors.inkDim, fontSize: 10.5 },
  pillGoodText: { color: colors.accent },
  pillWarnText: { color: colors.warn },
  pillAccentText: { color: colors.accent2 },
  stat: { flex: 1, gap: 2 },
  statValue: { color: colors.ink, fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] },
  statAccent: { color: colors.accent },
  statLabel: { color: colors.inkFaint, fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.8 },
  field: {
    backgroundColor: colors.cardSoft,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.ink,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14,
    minHeight: 44,
  },
  banner: { borderRadius: radius.sm, borderWidth: 1, padding: 12 },
  bannerError: { borderColor: "rgba(251,113,133,0.4)", backgroundColor: "rgba(251,113,133,0.08)" },
  bannerOk: { borderColor: "rgba(76,224,179,0.35)", backgroundColor: "rgba(76,224,179,0.08)" },
  bannerText: { fontSize: 12.5 },
  bannerErrorText: { color: "#fecdd3" },
  bannerOkText: { color: "#bbf7d0" },
});
