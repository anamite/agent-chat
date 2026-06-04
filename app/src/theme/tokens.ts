/**
 * tokens.ts — Hermes design system (dark-first, lime accent).
 *
 * Mirrors design/hermes-design.html. Two visual modes share one palette:
 *   - Console: dense, hairline borders, bubbleless agent text.
 *   - Canvas:  roomy, elevated, rounded agent bubbles, lime user bubbles.
 */

export const colors = {
  canvas: "#08090A", // app background (design: bg)
  surface: "#15171A", // raised controls / steppers / inputs (design: bg3)
  surfaceAlt: "#0E0F11", // widget card surface, one step above canvas (design: bg2)
  inputBg: "#101113", // text-field fill (design: bgInput)
  border: "#1C1E22", // soft hairline borders (design: border)
  borderStrong: "#2A2D33", // stronger dividers / control outlines (design: borderStrong)

  text: "#F3F4F5", // primary text
  text2: "#969BA3", // secondary / muted text
  text3: "#5A5F68", // tertiary / disabled

  accent: "#D6FF3D", // lime / neon — primary accent + user bubble
  accentDim: "#A9CC2E", // pressed / dimmed accent
  accentInk: "#0B0C0A", // text/icon on top of accent

  ok: "#5CE08F",
  warn: "#F5C451",
  fail: "#FF6B5E",
} as const;

/** Translucent accent/status fills for tinted chips & soft surfaces. */
export const tint = {
  accent: "rgba(214,255,61,0.12)",
  accentBorder: "rgba(214,255,61,0.25)",
  ok: "rgba(92,224,143,0.12)",
  okBorder: "rgba(92,224,143,0.22)",
  warn: "rgba(245,196,81,0.12)",
  warnBorder: "rgba(245,196,81,0.22)",
  fail: "rgba(255,107,94,0.12)",
  failBorder: "rgba(255,107,94,0.22)",
} as const;

export const font = {
  // Geist family is bundled at the app layout level (expo-font).
  sans: "Geist",
  mono: "GeistMono",
  // Fallbacks before the custom font loads.
  sansFallback: "System",
  monoFallback: "monospace",
} as const;

export const weight = {
  light: "300",
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export const radius = {
  card: 16, // rounded cards (Canvas mode)
  console: 8, // console cards
  widget: 8, // agent-emitted widget cards (Console mode — design: t.card)
  control: 3, // inputs / buttons
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const fontSize = {
  xs: 11, // mono labels / timestamps
  sm: 13,
  md: 15, // body
  lg: 18,
  xl: 24,
  xxl: 32,
} as const;

export const hairline = 1;

/** Visual mode toggle (see §2 of the build plan). */
export type VisualMode = "console" | "canvas";

export const theme = {
  colors,
  tint,
  font,
  weight,
  radius,
  space,
  fontSize,
  hairline,
} as const;

export type Theme = typeof theme;
export default theme;
