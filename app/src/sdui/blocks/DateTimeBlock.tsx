import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { DateTimeBlock as DateTimeBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import { Btn, WidgetCard, WTitle } from "../primitives";
import { colors, font, fontSize, radius, space, weight } from "../../theme/tokens";

/**
 * DateTimeBlock — a scheduler. Pick one day from a horizontal row of options
 * and confirm; the (display) time is provided by the agent. Confirm emits an
 * `action` event whose value is "<day value> <time> <meridiem>".
 */
export default function DateTimeBlock({ block, msgId }: { block: DateTimeBlockT; msgId: string }) {
  const { sendAction } = useBlockEvents(msgId);
  const [sel, setSel] = useState<string>(block.selected ?? block.days[0]?.value ?? "");
  const [sent, setSent] = useState(false);

  const confirm = () => {
    if (sent || !sel) return;
    setSent(true);
    const value = [sel, block.time, block.meridiem].filter(Boolean).join(" ");
    sendAction(block.id, block.id, value);
  };

  return (
    <WidgetCard>
      <WTitle kicker="Date & time" right={<Ionicons name="calendar-outline" size={17} color={colors.text3} />}>
        {block.label ?? "Pick a time"}
      </WTitle>

      <View style={styles.days}>
        {block.days.map((d) => {
          const on = d.value === sel;
          return (
            <Pressable
              key={d.value}
              disabled={sent}
              onPress={() => setSel(d.value)}
              style={[styles.day, on ? styles.dayOn : styles.dayOff]}
            >
              <Text style={[styles.dayName, { color: on ? colors.accentInk : colors.text3 }]}>
                {d.weekday.toUpperCase()}
              </Text>
              <Text style={[styles.dayNum, { color: on ? colors.accentInk : colors.text }]}>
                {d.day}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.bottom}>
        {block.time ? (
          <View style={styles.timeField}>
            <Ionicons name="time-outline" size={16} color={colors.text2} />
            <Text style={styles.time}>{block.time}</Text>
            {block.meridiem ? <Text style={styles.meridiem}>{block.meridiem}</Text> : null}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Btn
          kind="primary"
          label={sent ? "Confirmed" : block.confirmLabel ?? "Confirm"}
          icon={sent ? "checkmark" : undefined}
          disabled={sent}
          dim={sent}
          onPress={confirm}
        />
      </View>
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  days: { flexDirection: "row", gap: 7, marginBottom: space.md },
  day: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: "center",
  },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayOff: { backgroundColor: colors.surface, borderColor: colors.border },
  dayName: { fontFamily: font.mono, fontSize: 10, marginBottom: 3 },
  dayNum: { fontSize: fontSize.lg - 2, fontWeight: weight.semibold },

  bottom: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  timeField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  time: { fontFamily: font.mono, fontSize: fontSize.sm + 1, color: colors.text, fontWeight: weight.medium },
  meridiem: { fontFamily: font.mono, fontSize: fontSize.sm, color: colors.text3 },
});
