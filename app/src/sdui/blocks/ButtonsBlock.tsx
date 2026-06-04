import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ButtonsBlock as ButtonsBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import { colors, fontSize, radius, space, weight } from "../../theme/tokens";

/**
 * ButtonsBlock — a row of tappable buttons. Tapping sends an `action` event
 * (source = button id, name = label, value = value) and locks the row so the
 * choice can't be double-sent.
 */
export default function ButtonsBlock({
  block,
  msgId,
}: {
  block: ButtonsBlockT;
  msgId: string;
}) {
  const { sendAction } = useBlockEvents(msgId);
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <View style={styles.row}>
      {block.buttons.map((b) => {
        const picked = chosen === b.id;
        const dim = chosen != null && !picked;
        return (
          <Pressable
            key={b.id}
            disabled={chosen != null}
            onPress={() => {
              setChosen(b.id);
              sendAction(b.id, b.label, b.value ?? b.label);
            }}
            style={[
              styles.btn,
              b.style === "primary" && styles.primary,
              b.style === "danger" && styles.danger,
              dim && styles.dim,
            ]}
          >
            <Text
              style={[
                styles.label,
                b.style === "primary" && styles.labelPrimary,
                b.style === "danger" && styles.labelDanger,
              ]}
            >
              {b.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  btn: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  danger: { borderColor: colors.fail, backgroundColor: "transparent" },
  dim: { opacity: 0.4 },
  label: { color: colors.text, fontSize: fontSize.md, fontWeight: weight.medium },
  labelPrimary: { color: colors.accentInk, fontWeight: weight.semibold },
  labelDanger: { color: colors.fail },
});
