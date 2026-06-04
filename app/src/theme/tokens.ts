/**
 * tokens.ts — Hermes design system (dark-first, lime accent).
 *
 * Mirrors design/hermes-design.html. Two visual modes share one palette:
 *   - Console: dense, hairline borders, bubbleless agent text.
 *   - Canvas:  roomy, elevated, rounded agent bubbles, lime user bubbles.
 */

export const colors = {
  canvas: "#08090A", // app background
  surface: "#15171A", // cards, inputs, elevated rows
  surfaceAlt: "#0F1113", // slightly raised vs canvas
  border: "#2A2D33", // hairline borders

  text: "#F3F4F5", // primary text
  text2: "#969BA3", // secondary / muted text
  text3: "#5A5E66", // tertiary / disabled

  accent: "#D6FF3D", // lime / neon — primary accent + user bubble
  accentInk: "#0A0C00", // text/icon on top of accent

  ok: "#5CE08F",
  warn: "#F5C451",
  fail: "#FF6B5E",
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
  font,
  weight,
  radius,
  space,
  fontSize,
  hairline,
} as const;

export type Theme = typeof theme;
export default theme;
