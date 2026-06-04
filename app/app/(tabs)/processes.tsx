import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, fontSize, radius, space, weight } from "../../src/theme/tokens";

/**
 * Processes — running agent tasks (status, sub-task log, pause/stop/retry).
 * M0 placeholder; populated once the agent emits process events (M3+).
 */
export default function ProcessesScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>NO RUNNING TASKS</Text>
          <Text style={styles.cardBody}>
            Long-running agent tasks will appear here with live status, a
            sub-task log, and pause / stop / retry controls.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingHorizontal: space.lg, paddingVertical: space.md },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: weight.bold },
  content: { padding: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.lg,
  },
  cardLabel: {
    color: colors.text2,
    fontSize: fontSize.xs,
    letterSpacing: 1,
    marginBottom: space.sm,
  },
  cardBody: { color: colors.text2, fontSize: fontSize.md, lineHeight: 21 },
});
