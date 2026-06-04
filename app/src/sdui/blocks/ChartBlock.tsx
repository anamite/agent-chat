/**
 * ChartBlock.tsx — chart rendering via react-native-gifted-charts.
 *
 * Supports chartType: line | bar | area | pie.
 * Maps our protocol shape (series[{label?, data[], color?}] + labels[])
 * to gifted-charts' data items. Multiple series = grouped bars (bar)
 * or multi-line overlays (line/area). Pie uses the first series only.
 *
 * Dark theme: canvas bg, lime accent data color, muted axes.
 */

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BarChart, LineChart, PieChart } from "react-native-gifted-charts";
import type { ChartBlock as ChartBlockT } from "../../protocol/protocol";
import { colors, fontSize, radius, space, weight } from "../../theme/tokens";

// A palette that works on dark background; accent (lime) first.
const PALETTE = [
  colors.accent,       // #D6FF3D
  "#5CE08F",           // ok green
  "#F5C451",           // warn yellow
  "#FF6B5E",           // fail red
  "#60B4FF",           // blue
  "#C084FC",           // purple
  "#FB923C",           // orange
  "#34D399",           // teal
];

function seriesColor(i: number, override?: string) {
  return override ?? PALETTE[i % PALETTE.length];
}

const CHART_W = 280;
const CHART_H = 160;
const BAR_W = 18;
const GROUP_BAR_W = 12;

// Shared axis styling for bar / line / area.
const AXIS_LABEL_STYLE = { color: colors.text2, fontSize: 9 };

// ---------------------------------------------------------------------------
// Bar chart
// ---------------------------------------------------------------------------

function BarViz({ block }: { block: ChartBlockT }) {
  const labels = block.labels ?? block.series[0].data.map((_, i) => String(i + 1));

  if (block.series.length === 1) {
    // Single series — simple bar chart.
    const color = seriesColor(0, block.series[0].color);
    const items = block.series[0].data.map((v, i) => ({
      value: v,
      label: labels[i] ?? String(i + 1),
      frontColor: color,
      labelTextStyle: AXIS_LABEL_STYLE,
    }));

    return (
      <BarChart
        data={items}
        width={CHART_W}
        height={CHART_H}
        barWidth={BAR_W}
        barBorderRadius={3}
        frontColor={color}
        backgroundColor={colors.surface}
        xAxisColor={colors.border}
        yAxisColor={colors.border}
        yAxisTextStyle={{ color: colors.text2, fontSize: 9 }}
        xAxisLabelTextStyle={AXIS_LABEL_STYLE}
        noOfSections={4}
        rulesColor={colors.border}
        rulesType="dashed"
        isAnimated
        animationDuration={600}
      />
    );
  }

  // Multi-series — grouped bars via barGroups (label on the first bar of each
  // group). `barGroups` isn't in the lib's public prop types, so spread via any.
  const rebuilt = block.series[0].data.map((_, i) => ({
    barItems: block.series.map((s, si) => ({
      value: s.data[i] ?? 0,
      frontColor: seriesColor(si, s.color),
      label: si === 0 ? (labels[i] ?? String(i + 1)) : undefined,
      labelTextStyle: si === 0 ? AXIS_LABEL_STYLE : undefined,
    })),
  }));

  const groupedProps: any = {
    barGroups: rebuilt,
    width: CHART_W * Math.max(1, block.series[0].data.length / 6),
    height: CHART_H,
    barWidth: GROUP_BAR_W,
    barBorderRadius: 2,
    backgroundColor: colors.surface,
    xAxisColor: colors.border,
    yAxisColor: colors.border,
    yAxisTextStyle: { color: colors.text2, fontSize: 9 },
    xAxisLabelTextStyle: AXIS_LABEL_STYLE,
    noOfSections: 4,
    rulesColor: colors.border,
    rulesType: "dashed",
    isAnimated: true,
    animationDuration: 600,
  };

  return <BarChart {...groupedProps} />;
}

// ---------------------------------------------------------------------------
// Line / Area chart
// ---------------------------------------------------------------------------

function LineOrArea({ block, type }: { block: ChartBlockT; type: "line" | "area" }) {
  const labels = block.labels ?? block.series[0].data.map((_, i) => String(i + 1));

  const makeData = (seriesIdx: number) =>
    block.series[seriesIdx].data.map((v, i) => ({
      value: v,
      label: labels[i] ?? String(i + 1),
      labelTextStyle: AXIS_LABEL_STYLE,
      dataPointColor: seriesColor(seriesIdx, block.series[seriesIdx].color),
    }));

  const primaryColor = seriesColor(0, block.series[0].color);

  // Build LineChart props; pass extra series as data2, data3, etc.
  const chartProps: any = {
    color1: primaryColor,
    thickness1: 2,
    dataPointsColor1: primaryColor,
    dataPointsRadius1: 3,
    areaChart: type === "area",
    startFillColor1: primaryColor,
    startOpacity: 0.25,
    endOpacity: 0.02,
    data: makeData(0),
  };

  if (block.series.length > 1) {
    const s1 = block.series[1];
    const c1 = seriesColor(1, s1.color);
    chartProps.data2 = makeData(1);
    chartProps.color2 = c1;
    chartProps.thickness2 = 2;
    chartProps.dataPointsColor2 = c1;
    chartProps.dataPointsRadius2 = 3;
    if (type === "area") {
      chartProps.startFillColor2 = c1;
    }
  }

  if (block.series.length > 2) {
    const s2 = block.series[2];
    const c2 = seriesColor(2, s2.color);
    chartProps.data3 = makeData(2);
    chartProps.color3 = c2;
    chartProps.thickness3 = 2;
    chartProps.dataPointsColor3 = c2;
    chartProps.dataPointsRadius3 = 3;
    if (type === "area") {
      chartProps.startFillColor3 = c2;
    }
  }

  return (
    <LineChart
      {...chartProps}
      width={CHART_W}
      height={CHART_H}
      backgroundColor={colors.surface}
      xAxisColor={colors.border}
      yAxisColor={colors.border}
      yAxisTextStyle={{ color: colors.text2, fontSize: 9 }}
      xAxisLabelTextStyle={AXIS_LABEL_STYLE}
      noOfSections={4}
      rulesColor={colors.border}
      rulesType="dashed"
      curved
      isAnimated
      animationDuration={600}
    />
  );
}

// ---------------------------------------------------------------------------
// Pie chart (donut)
// ---------------------------------------------------------------------------

function PieViz({ block }: { block: ChartBlockT }) {
  const primary = block.series[0];
  const labels = block.labels ?? primary.data.map((_, i) => String(i + 1));
  const pieColors = block.series.map((s, i) => seriesColor(i, s.color));

  // One pie segment per data point in the first series.
  const items = primary.data.map((v, i) => ({
    value: v,
    label: labels[i] ?? String(i + 1),
    color: pieColors[i % pieColors.length],
    textColor: colors.text,
    textSize: 10,
  }));

  // Compute total for the center label.
  const total = primary.data.reduce((sum, v) => sum + v, 0);
  const totalStr = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);

  return (
    <PieChart
      data={items}
      radius={70}
      innerRadius={30}
      donut
      strokeColor={colors.surface}
      strokeWidth={2}
      focusOnPress
      showText
      centerLabelComponent={() => (
        <View style={styles.pieCenter}>
          <Text style={styles.pieTotal}>{totalStr}</Text>
          <Text style={styles.pieLabel}>{primary.label ?? ""}</Text>
        </View>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Main ChartBlock component
// ---------------------------------------------------------------------------

function ChartLabel({ text }: { text: string }) {
  return <Text style={styles.typeLabel}>{text.toUpperCase()}</Text>;
}

/** ChartBlock — compact dark chart card with type label. */
export default function ChartBlock({ block }: { block: ChartBlockT }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {block.title ? <Text style={styles.title}>{block.title}</Text> : null}
        <ChartLabel text={block.chartType} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {block.chartType === "pie" ? (
          <View style={styles.pieWrap}>
            <PieViz block={block} />
          </View>
        ) : block.chartType === "bar" ? (
          <View style={styles.chartWrap}>
            <BarViz block={block} />
          </View>
        ) : (
          <View style={styles.chartWrap}>
            <LineOrArea block={block} type={block.chartType as "line" | "area"} />
          </View>
        )}
      </ScrollView>

      {/* Legend for multi-series */}
      {block.series.length > 1 ? (
        <View style={styles.legend}>
          {block.series.map((s, i) => (
            <View key={i} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: seriesColor(i, s.color) }]} />
              <Text style={styles.legendText}>{s.label ?? `Series ${i + 1}`}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: weight.semibold,
    flexShrink: 1,
  },
  typeLabel: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: weight.bold,
    letterSpacing: 1,
  },
  chartWrap: {
    paddingVertical: space.xs,
    paddingRight: space.sm,
  },
  pieWrap: {
    alignItems: "center",
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  pieCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  pieTotal: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: weight.bold,
  },
  pieLabel: {
    color: colors.text2,
    fontSize: fontSize.xs,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  legendText: {
    color: colors.text2,
    fontSize: fontSize.xs,
  },
});
