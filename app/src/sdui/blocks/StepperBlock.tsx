import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { StepperBlock as StepperBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import { Btn, WidgetCard, WTitle } from "../primitives";
import { colors, font, fontSize, radius, weight } from "../../theme/tokens";

/**
 * StepperBlock — a numeric value setter with −/+ steppers and an Apply action.
 * Tapping Apply emits an `action` event (value = the chosen number as a
 * string) and locks the control.
 */
export default function StepperBlock({ block, msgId }: { block: StepperBlockT; msgId: string }) {
  const { sendAction } = useBlockEvents(msgId);
  const step = block.step ?? 1;
  const [val, setVal] = useState(block.value);
  const [sent, setSent] = useState(false);

  const clamp = (n: number) => {
    let x = n;
    if (block.min != null) x = Math.max(block.min, x);
    if (block.max != null) x = Math.min(block.max, x);
    return Math.round(x * 1000) / 1000;
  };
  const bump = (dir: 1 | -1) => !sent && setVal((v) => clamp(v + dir * step));

  const atMin = block.min != null && val <= block.min;
  const atMax = block.max != null && val >= block.max;

  const rangeBits = [
    block.min != null && block.max != null ? `RANGE ${block.min}–${block.max}` : null,
    `STEP ${step}`,
  ].filter(Boolean);

  return (
    <WidgetCard>
      <WTitle kicker="Value input">{block.label ?? "Set a value"}</WTitle>
      <View style={styles.row}>
        <StepBtn icon="remove" onPress={() => bump(-1)} disabled={sent || atMin} />
        <View style={styles.readout}>
          <Text style={styles.value}>
            {val}
            {block.unit ? <Text style={styles.unit}>{block.unit}</Text> : null}
          </Text>
          {rangeBits.length ? <Text style={styles.range}>{rangeBits.join(" · ")}</Text> : null}
        </View>
        <StepBtn icon="add" onPress={() => bump(1)} disabled={sent || atMax} />
      </View>
      <Btn
        full
        kind="primary"
        label={sent ? "Applied" : block.submitLabel ?? "Apply"}
        icon={sent ? "checkmark" : undefined}
        disabled={sent}
        dim={sent}
        onPress={() => {
          setSent(true);
          sendAction(block.id, block.id, String(val));
        }}
        style={styles.apply}
      />
    </WidgetCard>
  );
}

function StepBtn({
  icon,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.stepBtn, disabled && styles.dim]}>
      <Ionicons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { opacity: 0.4 },
  readout: { flex: 1, alignItems: "center" },
  value: {
    fontSize: 40,
    fontWeight: weight.semibold,
    letterSpacing: -1.5,
    lineHeight: 44,
    color: colors.text,
  },
  unit: { fontSize: 20, color: colors.text2, fontWeight: weight.medium },
  range: {
    fontFamily: font.mono,
    fontSize: 10.5,
    color: colors.text3,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  apply: { marginTop: 14 },
});
