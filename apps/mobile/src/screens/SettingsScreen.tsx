import type { CapabilitiesResponse, HealthResponse, MemoryView, SessionReady } from "@quanstate/services";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { Card, GhostButton, Pill, SectionTitle } from "../components/Primitives";
import { colors, spacing } from "../theme";

interface SettingsScreenProps {
  autoSpeak: boolean;
  onChangeAutoSpeak: (value: boolean) => void;
  ready: SessionReady | null;
  health: HealthResponse | null;
  capabilities: CapabilitiesResponse | null;
  memory: MemoryView | null;
  apiBase: string;
  online: boolean;
  onResetMemory: () => Promise<void>;
  onOpenPair: () => void;
}

export function SettingsScreen({
  autoSpeak,
  onChangeAutoSpeak,
  ready,
  health,
  capabilities,
  memory,
  apiBase,
  online,
  onResetMemory,
  onOpenPair,
}: SettingsScreenProps) {
  const confirmReset = () => {
    Alert.alert("Reset learned memory", "Delete every phrase, glossary term and hotword this profile learned?", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: () => void onResetMemory() },
    ]);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View>
        <Text style={styles.eyebrow}>CONFIGURATION</Text>
        <Text style={styles.title}>Device settings</Text>
        <Text style={styles.subtitle}>Voice, input routing and the latency contract for this phone.</Text>
      </View>

      <Card>
        <SectionTitle>Voice output</SectionTitle>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Speak translations automatically</Text>
            <Text style={styles.rowDetail}>Uses the native iOS/Android voice the moment a translation lands.</Text>
          </View>
          <Switch
            value={autoSpeak}
            onValueChange={onChangeAutoSpeak}
            trackColor={{ false: colors.line, true: "rgba(76,224,179,0.4)" }}
            thumbColor={autoSpeak ? colors.accent : colors.inkFaint}
          />
        </View>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Language pair</Text>
            <Text style={styles.rowDetail}>{ready ? `${ready.sourceLang.toUpperCase()} → ${ready.targetLang.toUpperCase()}` : "not connected"}</Text>
          </View>
          <GhostButton label="Change" onPress={onOpenPair} />
        </View>
      </Card>

      <Card>
        <SectionTitle>Speech input</SectionTitle>
        <Text style={styles.paragraph}>
          Mobile uses the platform speech recognizer for instant partials, then sends each final utterance into the shared
          realtime pipeline. Server-side Whisper is used on the web client (and by native builds that add a PCM capture
          bridge through <Text style={styles.code}>MicrophoneStream</Text>).
        </Text>
        <View style={styles.tags}>
          <Pill label={`engine · ${ready?.engines.speechToText ?? "none"}`} tone="warn" />
          <Pill label="on-device partials" tone="good" />
          <Pill label={`${ready?.sampleRate ?? 16000} Hz PCM wire format`} />
        </View>
      </Card>

      <Card>
        <SectionTitle hint={online ? "reachable" : "offline"}>Service</SectionTitle>
        <Row label="Endpoint" value={apiBase} />
        <Row label="Status" value={health ? `${health.status} · v${health.version}` : "unreachable"} />
        <Row label="Translation" value={health?.engines.translation ?? "—"} />
        <Row label="Speech to text" value={health?.engines.speechToText ?? "—"} />
        <Row label="Text to speech" value={health?.engines.textToSpeech ?? "—"} />
        <Row label="Memory version" value={`${memory?.version ?? ready?.memory.version ?? "—"}`} />
      </Card>

      <Card>
        <SectionTitle>Latency contract</SectionTitle>
        <Row label="End-to-end p95" value={`${ready?.budget.endToEndMs ?? 100} ms`} />
        <Row label="Fast path" value={`${ready?.budget.fastPathMs ?? 5} ms`} />
        <Row label="Audio frame" value={`${ready?.budget.frameMs ?? 20} ms`} />
        <Text style={styles.paragraph}>
          Neural inference cannot run in 5 ms on a CPU, so the pipeline keeps a versioned translation cache and learned
          phrase memory in front of every model. The live screen shows measured p95 against the contract.
        </Text>
      </Card>

      <Card tone="danger">
        <SectionTitle>Learned memory</SectionTitle>
        <Text style={styles.paragraph}>
          {memory?.stats.phrases ?? 0} phrases · {memory?.stats.glossary ?? 0} protected terms · {memory?.stats.documents ?? 0} uploads
        </Text>
        <GhostButton label="Reset learned memory" onPress={confirmReset} />
      </Card>

      <Text style={styles.footer}>
        Quanstate · capabilities {capabilities ? JSON.stringify(capabilities.engines) : "—"}
      </Text>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 110, gap: spacing.md },
  eyebrow: { color: colors.accent, fontSize: 10, letterSpacing: 1.8, fontWeight: "700", marginBottom: 6 },
  title: { color: colors.ink, fontSize: 27, fontWeight: "700", letterSpacing: -0.7 },
  subtitle: { color: colors.inkDim, fontSize: 13, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.ink, fontSize: 13.5, fontWeight: "600" },
  rowDetail: { color: colors.inkFaint, fontSize: 10.5, lineHeight: 15 },
  paragraph: { color: colors.inkDim, fontSize: 11.5, lineHeight: 18 },
  code: { color: colors.accent, fontSize: 10.5 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  kvLabel: { color: colors.inkFaint, fontSize: 11.5 },
  kvValue: { color: colors.inkDim, fontSize: 10.5, maxWidth: "64%", textAlign: "right" },
  footer: { color: colors.inkFaint, fontSize: 9.5, textAlign: "center" },
});
