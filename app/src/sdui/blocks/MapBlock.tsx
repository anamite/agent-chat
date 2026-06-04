import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import type { MapBlock as MapBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import { Btn, WidgetCard } from "../primitives";
import { colors, font, fontSize, space, weight } from "../../theme/tokens";

const MAP_H = 132;
const GRID = 26;

/**
 * MapBlock — a location snippet. We don't ship a tile provider, so the map is a
 * stylized faux grid with a pin; the place name + caption sit below. An optional
 * action button (e.g. Directions) emits an `action` event.
 */
export default function MapBlock({ block, msgId }: { block: MapBlockT; msgId: string }) {
  const { sendAction } = useBlockEvents(msgId);
  const [tapped, setTapped] = useState(false);
  const [w, setW] = useState(0);
  const cols = Math.ceil(w / GRID);
  const rows = Math.ceil(MAP_H / GRID);

  return (
    <WidgetCard pad={false}>
      <View style={styles.map} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 ? (
          <Svg width={w} height={MAP_H} style={StyleSheet.absoluteFill}>
            {Array.from({ length: cols }, (_, i) => (
              <Line key={`v${i}`} x1={i * GRID} y1={0} x2={i * GRID} y2={MAP_H} stroke={colors.border} strokeWidth={1} />
            ))}
            {Array.from({ length: rows }, (_, i) => (
              <Line key={`h${i}`} x1={0} y1={i * GRID} x2={w} y2={i * GRID} stroke={colors.border} strokeWidth={1} />
            ))}
            <Path d={`M-10 90 L${w * 0.3} 60 L${w * 0.55} 100 L${w + 10} 50`} stroke={colors.borderStrong} strokeWidth={6} fill="none" strokeLinecap="round" opacity={0.7} />
            <Path d={`M${w * 0.15} -10 L${w * 0.24} 70 L${w * 0.18} 150`} stroke={colors.borderStrong} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.5} />
          </Svg>
        ) : null}

        <View style={styles.pinWrap}>
          {block.pin ? <Text style={styles.pinLabel}>{block.pin}</Text> : null}
          <View style={styles.pinDot} />
        </View>
      </View>

      <View style={styles.footer}>
        <Ionicons name="location" size={18} color={colors.accent} />
        <View style={styles.footText}>
          <Text style={styles.label} numberOfLines={1}>{block.label}</Text>
          {block.caption ? <Text style={styles.caption}>{block.caption}</Text> : null}
        </View>
        {block.action ? (
          <Btn
            size="sm"
            kind="ghost"
            label={tapped ? "Sent" : block.action.label}
            disabled={tapped}
            dim={tapped}
            onPress={() => {
              setTapped(true);
              sendAction(block.action!.id, block.action!.label, block.action!.value ?? block.action!.label);
            }}
          />
        ) : null}
      </View>
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  map: { height: MAP_H, backgroundColor: colors.canvas, position: "relative", overflow: "hidden" },
  pinWrap: { position: "absolute", left: "44%", top: "26%", alignItems: "center" },
  pinLabel: {
    backgroundColor: colors.accentInk,
    color: colors.accent,
    fontFamily: font.mono,
    fontSize: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.accent,
    marginBottom: 4,
    overflow: "hidden",
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.accentInk,
  },
  footer: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: 13 },
  footText: { flex: 1, minWidth: 0 },
  label: { fontSize: fontSize.sm + 0.5, fontWeight: weight.semibold, color: colors.text },
  caption: { fontFamily: font.mono, fontSize: fontSize.xs, color: colors.text3, marginTop: 1 },
});
