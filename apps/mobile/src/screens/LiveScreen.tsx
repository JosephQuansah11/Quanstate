import { getLanguage, type MemoryView } from "@quanstate/services";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { Banner, Card, Field, GhostButton, Pill, PrimaryButton, SectionTitle, Stat } from "../components/Primitives";
import type { useMobileSession } from "../hooks/useMobileSession";
import { colors, radius, spacing } from "../theme";

interface LiveScreenProps {
  session: ReturnType<typeof useMobileSession>;
  sourceLang: string;
  targetLang: string;
  online: boolean;
  memory: MemoryView | null;
  autoSpeak: boolean;
  onToggleAutoSpeak: (value: boolean) => void;
  onOpenPair: () => void;
  onOpenLearn: () => void;
}

export function LiveScreen({
  session,
  sourceLang,
  targetLang,
  online,
  memory,
  autoSpeak,
  onToggleAutoSpeak,
  onOpenPair,
  onOpenLearn,
}: LiveScreenProps) {
  const [draft, setDraft] = useState("");
  const source = getLanguage(sourceLang);
  const target = getLanguage(targetLang);
  const latest = session.entries[0];

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void session.sendText(text);
  };

  const statusLabel = session.listening ? "Listening" : session.status === "open" ? "Ready" : session.status === "reconnecting" ? "Reconnecting" : online ? "Idle" : "Offline";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Pressable style={styles.pairPill} onPress={onOpenPair} accessibilityRole="button">
          <Text style={styles.pairText}>{source?.code.toUpperCase()}</Text>
          <Text style={styles.pairArrow}>⇄</Text>
          <Text style={styles.pairText}>{target?.code.toUpperCase()}</Text>
        </Pressable>
        <View style={styles.headerRight}>
          <Pill label={statusLabel} tone={session.status === "open" ? "good" : "warn"} />
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Speak</Text>
            <Switch
              value={autoSpeak}
              onValueChange={onToggleAutoSpeak}
              trackColor={{ false: colors.line, true: "rgba(76,224,179,0.4)" }}
              thumbColor={autoSpeak ? colors.accent : colors.inkFaint}
            />
          </View>
        </View>
      </View>

      {session.error ? <Banner message={session.error} tone="error" /> : null}

      <Card>
        <View style={styles.stageBlock}>
          <Text style={styles.eyebrow}>{source?.name} · {source?.code.toUpperCase()}</Text>
          <Text style={styles.sourceText}>{session.partial || latest?.sourceText || "Tap the microphone and start speaking."}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stageBlock}>
          <Text style={styles.eyebrow}>{target?.name} · {target?.code.toUpperCase()}</Text>
          <Text style={styles.targetText}>{latest?.targetText ?? "Translation appears here in real time."}</Text>
          {latest ? (
            <View style={styles.tags}>
              <Pill label={latest.cached ? "cached" : latest.latency ? `${Math.round(latest.latency.endToEndMs)} ms` : "live"} tone={latest.cached ? "good" : "default"} />
              <Pill label={`${Math.round(latest.confidence * 100)}% confidence`} />
              {latest.glossaryHits.slice(0, 2).map((term) => (
                <Pill key={term} label={term} tone="accent" />
              ))}
            </View>
          ) : null}
        </View>
      </Card>

      <View style={styles.micRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={session.listening ? "Stop listening" : "Start listening"}
          onPress={() => {
            if (session.listening) session.stopListening();
            else void session.startListening();
          }}
          style={({ pressed }) => [styles.mic, session.listening && styles.micLive, pressed && styles.micPressed]}
        >
          <Text style={styles.micGlyph}>{session.listening ? "■" : "◍"}</Text>
        </Pressable>
        <View style={styles.micCopy}>
          <Text style={styles.micTitle}>{session.listening ? "Listening — tap to stop" : "Tap to speak"}</Text>
          <Text style={styles.micSub}>
            {session.ready?.engines.speechToText === "none"
              ? "On-device recognition · shared translation memory"
              : `${session.ready?.engines.speechToText} · ${session.ready?.engines.translation}`}
          </Text>
        </View>
        {latest ? (
          <GhostButton label="Replay" onPress={() => session.speak(latest.targetText)} />
        ) : null}
      </View>

      <View style={styles.typeRow}>
        <Field
          value={draft}
          onChangeText={setDraft}
          placeholder={`Type in ${source?.name ?? "your language"}…`}
          returnKeyType="send"
          onSubmitEditing={send}
          style={styles.typeField}
        />
        <PrimaryButton label="Translate" onPress={send} disabled={!draft.trim()} />
      </View>

      <Card>
        <SectionTitle hint={session.entries.length ? `${session.entries.length} utterances` : undefined}>Session transcript</SectionTitle>
        {session.entries.length === 0 ? (
          <Text style={styles.empty}>Nothing yet. Try “Where is the train station?” — then teach the device your own vocabulary.</Text>
        ) : (
          session.entries.map((entry) => (
            <View key={entry.id} style={styles.entry}>
              <Text style={styles.entrySource}>{entry.sourceText}</Text>
              <Text style={styles.entryTarget}>{entry.targetText}</Text>
              <View style={styles.entryMeta}>
                <Text style={styles.entryMetaText}>{entry.latency ? `${Math.round(entry.latency.endToEndMs)} ms` : "—"}</Text>
                {entry.cached ? <Pill label="cached" tone="good" /> : null}
                {entry.glossaryHits.length ? <Pill label={`${entry.glossaryHits.length} glossary`} tone="accent" /> : null}
                <Pressable onPress={() => session.speak(entry.targetText)} accessibilityRole="button">
                  <Text style={styles.replay}>Replay</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <SectionTitle hint={online ? "live" : "offline"}>Telemetry</SectionTitle>
        <View style={styles.statsRow}>
          <Stat label="p50" value={session.stats.p50 ? `${Math.round(session.stats.p50)}ms` : "—"} />
          <Stat label="p95" value={session.stats.p95 ? `${Math.round(session.stats.p95)}ms` : "—"} accent />
          <Stat label="cache" value={`${Math.round(session.stats.cacheHitRate * 100)}%`} />
          <Stat label="phrases" value={`${memory?.stats.phrases ?? session.ready?.memory.phrases ?? 0}`} />
        </View>
        <Text style={styles.note}>
          p95 target is {session.ready?.budget.endToEndMs ?? 100} ms end-to-end; cached phrases answer in under{" "}
          {session.ready?.budget.fastPathMs ?? 5} ms.
        </Text>
        <Pressable onPress={onOpenLearn} accessibilityRole="button">
          <Text style={styles.link}>Teach your device a document or video →</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 110, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" },
  pairPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
  },
  pairText: { color: colors.ink, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  pairArrow: { color: colors.inkFaint, fontSize: 12 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  toggleLabel: { color: colors.inkFaint, fontSize: 11 },
  stageBlock: { gap: 6, paddingVertical: 4 },
  eyebrow: { color: colors.inkFaint, fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase" },
  sourceText: { color: colors.inkDim, fontSize: 19, lineHeight: 27 },
  targetText: { color: colors.ink, fontSize: 23, lineHeight: 31, fontWeight: "600" },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  micRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md },
  mic: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  micLive: { backgroundColor: colors.danger },
  micPressed: { opacity: 0.82 },
  micGlyph: { color: colors.accentInk, fontSize: 26, fontWeight: "700" },
  micCopy: { flex: 1, gap: 2 },
  micTitle: { color: colors.ink, fontSize: 14.5, fontWeight: "600" },
  micSub: { color: colors.inkFaint, fontSize: 10.5 },
  typeRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  typeField: { flex: 1 },
  empty: { color: colors.inkFaint, fontSize: 12.5, lineHeight: 19 },
  entry: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingVertical: 10, gap: 3 },
  entrySource: { color: colors.inkDim, fontSize: 12.5 },
  entryTarget: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  entryMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  entryMetaText: { color: colors.inkFaint, fontSize: 10.5 },
  replay: { color: colors.accent2, fontSize: 11.5 },
  statsRow: { flexDirection: "row", gap: spacing.sm, marginVertical: 4 },
  note: { color: colors.inkFaint, fontSize: 10.5, lineHeight: 16 },
  link: { color: colors.accent2, fontSize: 12.5, marginTop: 2 },
});
