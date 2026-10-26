import type { MemoryView, TranslationDevice } from "@quanstate/services";
import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Banner, Card, Field, Pill, PrimaryButton, SectionTitle, Stat } from "../components/Primitives";
import { colors, radius, spacing } from "../theme";

interface LearnScreenProps {
  device: TranslationDevice;
  sourceLang: string;
  targetLang: string;
  memory: MemoryView | null;
  onRefresh: () => Promise<void>;
}

export function LearnScreen({ device, sourceLang, targetLang, memory, onRefresh }: LearnScreenProps) {
  const [youtube, setYoutube] = useState("");
  const [glossary, setGlossary] = useState("Quanstate = Quanstate\ntranslation memory = memoria de traducción");
  const [busy, setBusy] = useState<"youtube" | "document" | "glossary" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (task: () => Promise<string>, kind: typeof busy) => {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      const result = await task();
      setMessage(result);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Learning failed");
    } finally {
      setBusy(null);
    }
  };

  const learnYoutube = () =>
    run(async () => {
      if (!youtube.trim()) throw new Error("Paste a YouTube URL first");
      const result = await device.learnYouTube(youtube.trim());
      setYoutube("");
      return `Learned ${result.document.segments ?? result.document.sentences} caption lines — ${result.memory.stats.phrases} phrases active.`;
    }, "youtube");

  const pickDocument = () =>
    run(async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          "text/*",
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return "No document selected";
      const asset = picked.assets[0]!;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const result = await device.learning.uploadDocument(blob, asset.name, {
        sourceLang,
        targetLang,
        profile: device.profile,
        title: asset.name,
      });
      return `${asset.name}: ${result.document.phrasesAdded} pairs, ${result.document.glossaryAdded} terms added.`;
    }, "document");

  const importGlossary = () =>
    run(async () => {
      const result = await device.learnText(glossary, "glossary.txt", "Pasted glossary");
      return `Imported ${result.document.phrasesAdded} pairs into memory.`;
    }, "glossary");

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View>
        <Text style={styles.eyebrow}>TEACHING</Text>
        <Text style={styles.title}>Teach your device</Text>
        <Text style={styles.subtitle}>
          Uploads become phrase pairs, protected terminology and speech hotwords. No retraining — it applies to the next sentence.
        </Text>
      </View>

      {message ? <Banner message={message} tone="ok" /> : null}
      {error ? <Banner message={error} tone="error" /> : null}

      <Card>
        <SectionTitle hint={`${sourceLang.toUpperCase()} → ${targetLang.toUpperCase()}`}>YouTube video</SectionTitle>
        <Field
          value={youtube}
          onChangeText={setYoutube}
          placeholder="https://www.youtube.com/watch?v=…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <PrimaryButton label={busy === "youtube" ? "Learning…" : "Learn from captions"} onPress={learnYoutube} busy={busy === "youtube"} disabled={busy !== null} />
        <Text style={styles.hint}>The service pulls the caption track and, when available, YouTube's translated track for a parallel corpus.</Text>
      </Card>

      <Card>
        <SectionTitle hint="txt · md · srt · vtt · csv · json · docx · pdf">Documents</SectionTitle>
        <PrimaryButton label={busy === "document" ? "Extracting…" : "Choose a document"} onPress={pickDocument} busy={busy === "document"} disabled={busy !== null} />
        <Text style={styles.hint}>Glossaries, transcripts, product docs — up to 20 MB.</Text>
      </Card>

      <Card>
        <SectionTitle hint="source = target">Paste a glossary</SectionTitle>
        <Field
          value={glossary}
          onChangeText={setGlossary}
          multiline
          numberOfLines={5}
          style={styles.textarea}
          autoCapitalize="none"
        />
        <PrimaryButton label={busy === "glossary" ? "Importing…" : "Import glossary"} onPress={importGlossary} busy={busy === "glossary"} disabled={busy !== null} />
      </Card>

      <Card>
        <SectionTitle hint={memory?.profile}>Translation memory</SectionTitle>
        <View style={styles.stats}>
          <Stat label="phrases" value={`${memory?.stats.phrases ?? 0}`} accent />
          <Stat label="from uploads" value={`${memory?.stats.learnedPhrases ?? 0}`} />
          <Stat label="glossary" value={`${memory?.stats.glossary ?? 0}`} />
          <Stat label="hotwords" value={`${memory?.stats.hotwords ?? 0}`} />
        </View>
        {memory?.glossary.length ? (
          <View style={styles.tags}>
            {memory.glossary.slice(0, 12).map((term) => (
              <Pill key={`${term.source}-${term.target}`} label={`${term.source} → ${term.target}`} tone="accent" />
            ))}
          </View>
        ) : null}
        {memory?.documents.map((document) => (
          <View key={document.id} style={styles.doc}>
            <View style={styles.docText}>
              <Text style={styles.docTitle} numberOfLines={1}>{document.title}</Text>
              <Text style={styles.docMeta}>
                {document.kind} · {document.phrasesAdded} pairs · {document.glossaryAdded} terms
              </Text>
            </View>
            <Pressable onPress={() => void onRefresh()} accessibilityRole="button">
              <Text style={styles.refresh}>↻</Text>
            </Pressable>
          </View>
        ))}
        {!memory?.documents.length ? <Text style={styles.hint}>Nothing learned yet.</Text> : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 110, gap: spacing.md },
  eyebrow: { color: colors.accent, fontSize: 10, letterSpacing: 1.8, fontWeight: "700", marginBottom: 6 },
  title: { color: colors.ink, fontSize: 27, fontWeight: "700", letterSpacing: -0.7 },
  subtitle: { color: colors.inkDim, fontSize: 13, lineHeight: 19, marginTop: 4 },
  hint: { color: colors.inkFaint, fontSize: 10.5, lineHeight: 16 },
  textarea: { minHeight: 100, textAlignVertical: "top", fontFamily: undefined },
  stats: { flexDirection: "row", gap: spacing.sm, marginVertical: 4 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 4 },
  doc: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 8 },
  docText: { flex: 1, gap: 1 },
  docTitle: { color: colors.ink, fontSize: 12.5, fontWeight: "600" },
  docMeta: { color: colors.inkFaint, fontSize: 10 },
  refresh: { color: colors.accent2, fontSize: 16 },
});
