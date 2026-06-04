import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SelectBlock as SelectBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import { colors, fontSize, radius, space, weight } from "../../theme/tokens";

/**
 * SelectBlock — single- or multi-select chips.
 *   - Form mode: controlled via `value` (string | string[]) + `onChange`.
 *   - Standalone: emits an `action` event on selection (value = comma-joined).
 */
export default function SelectBlock({
  block,
  msgId,
  value,
  onChange,
}: {
  block: SelectBlockT;
  msgId?: string;
  value?: string | string[];
  onChange?: (value: string | string[]) => void;
}) {
  const controlled = onChange != null;
  const events = useBlockEvents(msgId ?? "");
  const multi = !!block.multiple;
  const [local, setLocal] = useState<string[]>(() => normalize(value ?? block.value));
  const selected = controlled ? normalize(value) : local;

  const commit = (next: string[]) => {
    if (controlled) onChange!(multi ? next : (next[0] ?? ""));
    else {
      setLocal(next);
      if (msgId) events.sendAction(block.id, block.id, next.join(","));
    }
  };

  const toggle = (optValue: string) => {
    if (multi) {
      const next = selected.includes(optValue)
        ? selected.filter((v) => v !== optValue)
        : [...selected, optValue];
      commit(next);
    } else {
      commit([optValue]);
    }
  };

  return (
    <View style={styles.wrap}>
      {block.label ? <Text style={styles.label}>{block.label}</Text> : null}
      <View style={styles.options}>
        {block.options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <Pressable
              key={o.value}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => toggle(o.value)}
            >
              {on ? (
                <Ionicons name="checkmark" size={14} color={colors.accentInk} />
              ) : null}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function normalize(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  label: { color: colors.text2, fontSize: fontSize.sm, fontWeight: weight.medium },
  options: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: fontSize.sm },
  chipTextOn: { color: colors.accentInk, fontWeight: weight.semibold },
});
