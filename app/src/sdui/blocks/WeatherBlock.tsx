import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { WeatherBlock as WeatherBlockT, WeatherIcon } from "../../protocol/protocol";
import { WidgetCard } from "../primitives";
import { colors, font, fontSize, space, weight } from "../../theme/tokens";

const ICON: Record<WeatherIcon, keyof typeof Ionicons.glyphMap> = {
  sun: "sunny",
  cloud: "cloudy",
  rain: "rainy",
  snow: "snow",
  storm: "thunderstorm",
  fog: "cloud",
};

function iconColor(name?: WeatherIcon) {
  return name === "sun" ? colors.warn : colors.text2;
}

/** WeatherBlock — a read-only weather card with current conditions + hourly strip. */
export default function WeatherBlock({ block }: { block: WeatherBlockT }) {
  const unit = block.unit ?? "C";
  const cond = [
    block.condition,
    block.high != null ? `H ${block.high}°` : null,
    block.low != null ? `L ${block.low}°` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <WidgetCard>
      <View style={styles.top}>
        <View>
          <Text style={styles.location}>{block.location}</Text>
          <View style={styles.tempRow}>
            <Text style={styles.temp}>{block.temp}</Text>
            <Text style={styles.unit}>°{unit}</Text>
          </View>
          {cond ? <Text style={styles.cond}>{cond}</Text> : null}
        </View>
        {block.icon ? (
          <View style={[styles.iconCircle, { backgroundColor: "rgba(245,196,81,0.12)" }]}>
            <Ionicons name={ICON[block.icon]} size={30} color={iconColor(block.icon)} />
          </View>
        ) : null}
      </View>

      {block.hourly?.length ? (
        <View style={styles.hourly}>
          {block.hourly.map((h, i) => (
            <View key={i} style={styles.hour}>
              <Text style={styles.hourTime}>{h.time}</Text>
              <Ionicons name={ICON[h.icon ?? "cloud"]} size={17} color={iconColor(h.icon)} />
              <Text style={styles.hourTemp}>{h.temp}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  location: { fontSize: fontSize.sm, color: colors.text2, fontWeight: weight.medium },
  tempRow: { flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 2 },
  temp: { fontSize: 46, fontWeight: weight.semibold, letterSpacing: -2, lineHeight: 48, color: colors.text },
  unit: { fontSize: fontSize.lg, color: colors.text2, marginTop: 4 },
  cond: { fontSize: fontSize.sm, color: colors.text2, marginTop: 2 },
  iconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  hourly: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  hour: { alignItems: "center", gap: 6 },
  hourTime: { fontFamily: font.mono, fontSize: 10.5, color: colors.text3 },
  hourTemp: { fontSize: fontSize.sm, fontWeight: weight.semibold, color: colors.text },
});
