import { useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import type { SliderBlock as SliderBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import { colors, fontSize, radius, space, weight } from "../../theme/tokens";

const THUMB = 22;
const TRACK_H = 4;

/**
 * SliderBlock — a min/max/step range slider built on PanResponder (no native
 * dep). Form mode: controlled via `value` + `onChange`. Standalone: emits an
 * `action` event (value = number as string) when the drag is released.
 */
export default function SliderBlock({
  block,
  msgId,
  value,
  onChange,
}: {
  block: SliderBlockT;
  msgId?: string;
  value?: number;
  onChange?: (value: number) => void;
}) {
  const controlled = onChange != null;
  const events = useBlockEvents(msgId ?? "");
  const [local, setLocal] = useState<number>(value ?? block.value ?? block.min);
  const val = controlled ? (value ?? block.min) : local;
  const widthRef = useRef(0);

  const step = block.step ?? ((block.max - block.min) / 100 || 1);
  const range = block.max - block.min || 1;

  const quantize = (raw: number) => {
    const clamped = Math.max(block.min, Math.min(block.max, raw));
    const snapped = block.min + Math.round((clamped - block.min) / step) * step;
    return Math.round(snapped * 1000) / 1000;
  };

  const setFromX = (x: number) => {
    const w = widthRef.current || 1;
    const next = quantize(block.min + (x / w) * range);
    if (controlled) onChange!(next);
    else setLocal(next);
    return next;
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderRelease: (e) => {
        const next = setFromX(e.nativeEvent.locationX);
        if (!controlled && msgId) events.sendAction(block.id, block.id, String(next));
      },
    }),
  ).current;

  const fraction = Math.max(0, Math.min(1, (val - block.min) / range));

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        {block.label ? <Text style={styles.label}>{block.label}</Text> : <View />}
        <Text style={styles.value}>{val}</Text>
      </View>
      <View
        style={styles.trackArea}
        onLayout={(e) => (widthRef.current = e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={styles.track} />
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
        <View style={[styles.thumb, { left: `${fraction * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: colors.text2, fontSize: fontSize.sm, fontWeight: weight.medium },
  value: { color: colors.accent, fontSize: fontSize.sm, fontVariant: ["tabular-nums"] },
  trackArea: { height: THUMB, justifyContent: "center" },
  track: {
    height: TRACK_H,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  fill: {
    position: "absolute",
    height: TRACK_H,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    marginLeft: -THUMB / 2,
    borderWidth: 3,
    borderColor: colors.canvas,
  },
});
