import { createDevice, getLanguage, type CapabilitiesResponse, type HealthResponse, type MemoryView } from "@quanstate/services";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";

import { useMobileSession } from "./src/hooks/useMobileSession";
import { API_BASE } from "./src/lib/config";
import { LearnScreen } from "./src/screens/LearnScreen";
import { LiveScreen } from "./src/screens/LiveScreen";
import { PairScreen } from "./src/screens/PairScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { colors, spacing } from "./src/theme";

type ViewName = "live" | "learn" | "settings";

export default function App() {
  const device = useMemo(() => createDevice({ baseUrl: API_BASE }), []);
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("es");
  const [paired, setPaired] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [view, setView] = useState<ViewName>("live");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [memory, setMemory] = useState<MemoryView | null>(null);

  const session = useMobileSession({ device, sourceLang, targetLang, autoSpeak });

  const refreshMemory = async () => {
    try {
      setMemory(await device.memory());
    } catch {
      /* keep last snapshot while offline */
    }
  };

  const refreshService = async () => {
    try {
      const [healthResult, capabilityResult] = await Promise.all([device.health(), device.capabilities()]);
      setHealth(healthResult);
      setCapabilities(capabilityResult);
      setOnline(true);
      await refreshMemory();
    } catch {
      setOnline(false);
    }
  };

  useEffect(() => {
    device.setLanguages(sourceLang, targetLang);
  }, [device, sourceLang, targetLang]);

  useEffect(() => {
    void refreshService();
    const timer = setInterval(() => void refreshService(), 20_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!paired) return;
    void session.connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paired]);

  const applyPair = (next: { sourceLang: string; targetLang: string }) => {
    setSourceLang(next.sourceLang);
    setTargetLang(next.targetLang);
    device.setLanguages(next.sourceLang, next.targetLang);
  };

  if (!paired || pairOpen) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <PairScreen
          sourceLang={sourceLang}
          targetLang={targetLang}
          firstRun={!paired}
          onSelect={(pair) => {
            applyPair(pair);
            setPaired(true);
            setPairOpen(false);
            setView("live");
          }}
          onCancel={paired ? () => setPairOpen(false) : undefined}
        />
      </SafeAreaView>
    );
  }

  const source = getLanguage(sourceLang);
  const target = getLanguage(targetLang);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Pressable style={styles.brandRow} onPress={() => setView("live")} accessibilityRole="button">
          <View style={styles.mark}><Text style={styles.markText}>◍</Text></View>
          <Text style={styles.brand}>Quanstate</Text>
        </Pressable>
        <View style={styles.headerRight}>
          <Pressable style={styles.pairChip} onPress={() => setPairOpen(true)} accessibilityRole="button">
            <Text style={styles.pairChipText}>{source?.code.toUpperCase()} ⇄ {target?.code.toUpperCase()}</Text>
          </Pressable>
          <View style={[styles.dot, { backgroundColor: online ? colors.accent : colors.warn }]} />
        </View>
      </View>

      <View style={styles.body}>
        {view === "live" ? (
          <LiveScreen
            session={session}
            sourceLang={sourceLang}
            targetLang={targetLang}
            online={online}
            memory={memory}
            autoSpeak={autoSpeak}
            onToggleAutoSpeak={setAutoSpeak}
            onOpenPair={() => setPairOpen(true)}
            onOpenLearn={() => { setView("learn"); void refreshMemory(); }}
          />
        ) : null}
        {view === "learn" ? (
          <LearnScreen
            device={device}
            sourceLang={sourceLang}
            targetLang={targetLang}
            memory={memory}
            onRefresh={refreshMemory}
          />
        ) : null}
        {view === "settings" ? (
          <SettingsScreen
            autoSpeak={autoSpeak}
            onChangeAutoSpeak={setAutoSpeak}
            ready={session.ready}
            health={health}
            capabilities={capabilities}
            memory={memory}
            apiBase={API_BASE}
            online={online}
            onResetMemory={async () => {
              await device.learning.resetMemory(device.profile);
              await refreshMemory();
            }}
            onOpenPair={() => setPairOpen(true)}
          />
        ) : null}
      </View>

      <View style={styles.tabBar}>
        {([
          { key: "live", label: "Translate", glyph: "◉" },
          { key: "learn", label: "Teach", glyph: "✎" },
          { key: "settings", label: "Settings", glyph: "⚙" },
        ] as const).map((tab) => (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === tab.key }}
            onPress={() => { setView(tab.key); if (tab.key === "learn") void refreshMemory(); }}
            style={styles.tab}
          >
            <Text style={[styles.tabGlyph, view === tab.key && styles.tabActive]}>{tab.glyph}</Text>
            <Text style={[styles.tabLabel, view === tab.key && styles.tabActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  mark: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  markText: { color: colors.accentInk, fontSize: 16, fontWeight: "700" },
  brand: { color: colors.ink, fontSize: 16.5, fontWeight: "700", letterSpacing: -0.3 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pairChip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99 },
  pairChipText: { color: colors.inkDim, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  body: { flex: 1 },
  tabBar: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: "row",
    backgroundColor: "rgba(13,19,26,0.96)",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
    paddingVertical: 8,
    paddingHorizontal: 6,
    gap: 2,
  },
  tab: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 4 },
  tabGlyph: { color: colors.inkFaint, fontSize: 16 },
  tabLabel: { color: colors.inkFaint, fontSize: 10, fontWeight: "600" },
  tabActive: { color: colors.accent },
});
