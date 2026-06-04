/**
 * primitives.tsx — shared building blocks for agent-emitted widgets.
 *
 * Mirrors the design system's reusable parts (WCard, WTitle, Chip, Btn,
 * Stripe) so every widget shares one visual language: a soft-bordered surface
 * card, a mono uppercase "kicker" micro-label above the title, tinted status
 * chips, and 3px-radius primary/ghost/quiet/danger buttons.
 *
 * Console mode (dense, hairline, 8px cards) is the reference; see tokens.ts.
 */

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, fontSize, radius, space, tint, weight } from "../theme/tokens";

// ---------------------------------------------------------------------------
// WidgetCard — the shared surface for an agent-emitted widget.
// ---------------------------------------------------------------------------

export function WidgetCard({
  children,
  pad = true,
  style,
}: {
  children: ReactNode;
  /** false = flush content (e.g. embed/map that paint to the edge). */
  pad?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, pad && styles.cardPad, style]}>{children}</View>
  );
}

// ---------------------------------------------------------------------------
// Kicker — uppercase mono micro-label (e.g. "ACTION · NEEDS APPROVAL").
// ---------------------------------------------------------------------------

export function Kicker({ children }: { children: ReactNode }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

// ---------------------------------------------------------------------------
// WTitle — header row: kicker + title on the left, optional right slot.
// ---------------------------------------------------------------------------

export function WTitle({
  kicker,
  children,
  right,
}: {
  kicker?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <View style={styles.titleRow}>
      <View style={styles.titleCol}>
        {kicker ? <Kicker>{kicker}</Kicker> : null}
        <Text style={styles.title}>{children}</Text>
      </View>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chip — tinted pill label with an optional leading dot.
// ---------------------------------------------------------------------------

export type ChipTone = "default" | "accent" | "ok" | "warn" | "fail";

const CHIP_TONES: Record<ChipTone, { bg: string; fg: string; bd: string }> = {
  default: { bg: colors.surface, fg: colors.text2, bd: colors.border },
  accent: { bg: tint.accent, fg: colors.accent, bd: tint.accentBorder },
  ok: { bg: tint.ok, fg: colors.ok, bd: tint.okBorder },
  warn: { bg: tint.warn, fg: colors.warn, bd: tint.warnBorder },
  fail: { bg: tint.fail, fg: colors.fail, bd: tint.failBorder },
};

export function Chip({
  children,
  tone = "default",
  dot,
}: {
  children: ReactNode;
  tone?: ChipTone;
  dot?: boolean;
}) {
  const c = CHIP_TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg, borderColor: c.bd }]}>
      {dot ? <View style={[styles.chipDot, { backgroundColor: c.fg }]} /> : null}
      <Text style={[styles.chipText, { color: c.fg }]}>{children}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Btn — primary (lime) / ghost / quiet / danger, 3px radius, optional icon.
// ---------------------------------------------------------------------------

export type BtnKind = "primary" | "ghost" | "quiet" | "danger";
export type BtnSize = "sm" | "md";

export function Btn({
  label,
  onPress,
  kind = "ghost",
  size = "md",
  icon,
  full,
  disabled,
  dim,
  style,
}: {
  label: string;
  onPress?: () => void;
  kind?: BtnKind;
  size?: BtnSize;
  icon?: keyof typeof Ionicons.glyphMap;
  full?: boolean;
  disabled?: boolean;
  /** visually de-emphasize without blocking layout (e.g. unchosen option). */
  dim?: boolean;
  style?: ViewStyle;
}) {
  const fg =
    kind === "primary" ? colors.accentInk : kind === "danger" ? colors.fail : kind === "quiet" ? colors.text2 : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        size === "sm" ? styles.btnSm : styles.btnMd,
        BTN_KIND[kind],
        full && styles.btnFull,
        dim && styles.dim,
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={size === "sm" ? 15 : 16} color={fg} /> : null}
      <Text style={[styles.btnLabel, size === "sm" && styles.btnLabelSm, { color: fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const BTN_KIND: Record<BtnKind, ViewStyle> = {
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  ghost: { backgroundColor: "transparent", borderColor: colors.borderStrong },
  quiet: { backgroundColor: colors.surface, borderColor: colors.border },
  danger: { backgroundColor: "transparent", borderColor: colors.border },
};

// ---------------------------------------------------------------------------
// Stripe — diagonal-hatch placeholder for image / map / embed slots.
// ---------------------------------------------------------------------------

export function Stripe({
  label,
  height = 92,
  style,
}: {
  label: string;
  height?: number;
  style?: ViewStyle;
}) {
  // RN has no repeating-linear-gradient; approximate the hatch with a dashed
  // border + faint fill so it reads as an empty media slot.
  return (
    <View style={[styles.stripe, { height }, style]}>
      <Text style={styles.stripeLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.widget,
    overflow: "hidden",
  },
  cardPad: { padding: space.lg - 2 },

  kicker: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.text3,
    marginBottom: 4,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    marginBottom: space.md,
  },
  titleCol: { flexShrink: 1, minWidth: 0 },
  title: {
    fontSize: fontSize.md,
    fontWeight: weight.semibold,
    letterSpacing: -0.2,
    color: colors.text,
  },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.control,
    borderWidth: 1,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: {
    fontFamily: font.mono,
    fontSize: 11,
    fontWeight: weight.medium,
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },

  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: radius.control,
    borderWidth: 1,
  },
  btnMd: { paddingHorizontal: 15, paddingVertical: 10 },
  btnSm: { paddingHorizontal: 12, paddingVertical: 7 },
  btnFull: { flex: 1 },
  btnLabel: { fontSize: fontSize.sm + 1, fontWeight: weight.semibold, letterSpacing: -0.1 },
  btnLabelSm: { fontSize: fontSize.sm },
  dim: { opacity: 0.4 },

  stripe: {
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: "dashed",
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  stripeLabel: {
    fontFamily: font.mono,
    fontSize: fontSize.xs,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.text3,
  },
});
