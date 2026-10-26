import { LANGUAGES } from "@quanstate/services";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { Field } from "./Primitives";

interface LanguageModalProps {
  visible: boolean;
  title: string;
  selected: string;
  exclude: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

export function LanguageModal({ visible, title, selected, exclude, onSelect, onClose }: LanguageModalProps) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return LANGUAGES.filter((language) => language.code !== exclude).filter(
      (language) =>
        !needle ||
        language.name.toLowerCase().includes(needle) ||
        language.nativeName.toLowerCase().includes(needle) ||
        language.code.includes(needle),
    );
  }, [query, exclude]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close language list">
              <Text style={styles.close}>Done</Text>
            </Pressable>
          </View>
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder="Search languages"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <FlatList
            data={results}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item.code === selected }}
                onPress={() => {
                  onSelect(item.code);
                  setQuery("");
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.row,
                  item.code === selected && styles.rowSelected,
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.native}>
                    {item.nativeName}
                  </Text>
                  <Text style={styles.name}>
                    {item.name} · {item.code.toUpperCase()}
                  </Text>
                </View>
                {item.code === selected ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No matching language</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(3,6,9,0.72)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "86%",
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderColor: colors.line,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.ink, fontSize: 17, fontWeight: "700" },
  close: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  list: { paddingVertical: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowSelected: { backgroundColor: "rgba(76,224,179,0.08)" },
  rowPressed: { backgroundColor: "rgba(148,163,184,0.12)" },
  rowText: { flex: 1, gap: 1 },
  native: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  name: { color: colors.inkFaint, fontSize: 11.5 },
  check: { color: colors.accent, fontSize: 16, fontWeight: "700" },
  empty: { color: colors.inkFaint, padding: spacing.md, textAlign: "center" },
});
