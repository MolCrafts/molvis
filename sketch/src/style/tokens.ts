/**
 * Sketch design tokens — single source for chrome CSS defaults and canvas
 * fallbacks when no host DOM is available.
 *
 * Runtime theming path:
 * 1. Defaults live here as {@link SKETCH_TOKEN_DEFAULTS}.
 * 2. Injected CSS on `.molvis-sketch-composer` sets `--msk-*` from those defaults.
 * 3. Product hosts (page `.molvis-sketch-host`) override `--msk-*` with product
 *    tokens (`--color-accent`, …).
 * 4. Canvas paints via {@link readCanvasThemeFromHost}, which resolves
 *    `var(--msk-*)` to concrete colors Canvas 2D understands.
 *
 * Do **not** hardcode hex in board/renderer/composer — use tokens or CSS vars.
 *
 * Element/CPK label colors stay in {@link SKETCH_ELEMENT_COLORS}: they are
 * scientific structure-formula conventions, not product UI tokens.
 */

/** CSS custom property names (document for hosts + SKETCH_THEME_VARS). */
export const SKETCH_CSS_VARS = {
  railBg: "--msk-rail-bg",
  stageBg: "--msk-stage-bg",
  ink: "--msk-ink",
  muted: "--msk-muted",
  hover: "--msk-hover",
  active: "--msk-active",
  activeInk: "--msk-active-ink",
  activeFg: "--msk-active-fg",
  sep: "--msk-sep",
  radius: "--msk-radius",
  btn: "--msk-btn",
  shadow: "--msk-shadow",
  font: "--msk-font",
  /** Default swatch for the custom-color picker (`#rrggbb`). */
  customDefault: "--msk-custom-default",
} as const;

export type SketchCssVar =
  (typeof SKETCH_CSS_VARS)[keyof typeof SKETCH_CSS_VARS];

/**
 * Standalone defaults when no product host maps tokens.
 * Accent defaults to product teal (≈ page `--molvis-accent` oklch 195°).
 */
export const SKETCH_TOKEN_DEFAULTS = {
  railBg: "#f3f4f6",
  stageBg: "#ffffff",
  ink: "#1a1d23",
  muted: "#6b7280",
  hover: "rgba(0, 0, 0, 0.06)",
  active: "#ccebeb",
  activeInk: "#007d7e",
  activeFg: "#ffffff",
  sep: "#d1d5db",
  radius: "4px",
  btn: "34px",
  shadow: "0 8px 24px rgba(0, 0, 0, 0.14)",
  font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  /** Must stay six-digit hex — `<input type="color">` requires it. */
  customDefault: "#007d7e",
} as const;

export type SketchTokenName = keyof typeof SKETCH_TOKEN_DEFAULTS;

/** Ordered list of CSS vars hosts may override (chrome + canvas). */
export const SKETCH_THEME_VARS = [
  SKETCH_CSS_VARS.railBg,
  SKETCH_CSS_VARS.stageBg,
  SKETCH_CSS_VARS.ink,
  SKETCH_CSS_VARS.muted,
  SKETCH_CSS_VARS.hover,
  SKETCH_CSS_VARS.active,
  SKETCH_CSS_VARS.activeInk,
  SKETCH_CSS_VARS.activeFg,
  SKETCH_CSS_VARS.sep,
  SKETCH_CSS_VARS.radius,
  SKETCH_CSS_VARS.btn,
  SKETCH_CSS_VARS.shadow,
  SKETCH_CSS_VARS.font,
  SKETCH_CSS_VARS.customDefault,
] as const;

/**
 * Canvas {@link SketchRenderTheme} mapping onto `--msk-*`.
 * Paper / skeleton follow stage + ink; selection follows product accent.
 */
export const CANVAS_THEME_FROM_CSS = {
  background: SKETCH_CSS_VARS.stageBg,
  bondStroke: SKETCH_CSS_VARS.ink,
  labelFill: SKETCH_CSS_VARS.ink,
  selectionStroke: SKETCH_CSS_VARS.activeInk,
} as const;

/** Fallback canvas theme when no host element is available (tests / SSR). */
export function defaultCanvasTheme(): {
  background: string;
  bondStroke: string;
  labelFill: string;
  selectionStroke: string;
} {
  return {
    background: SKETCH_TOKEN_DEFAULTS.stageBg,
    bondStroke: SKETCH_TOKEN_DEFAULTS.ink,
    labelFill: SKETCH_TOKEN_DEFAULTS.ink,
    selectionStroke: SKETCH_TOKEN_DEFAULTS.activeInk,
  };
}

/** Build the `:root`-style default block for injected composer CSS. */
export function sketchTokenCssDefaults(): string {
  const d = SKETCH_TOKEN_DEFAULTS;
  const v = SKETCH_CSS_VARS;
  return [
    `${v.railBg}: ${d.railBg};`,
    `${v.stageBg}: ${d.stageBg};`,
    `${v.ink}: ${d.ink};`,
    `${v.muted}: ${d.muted};`,
    `${v.hover}: ${d.hover};`,
    `${v.active}: ${d.active};`,
    `${v.activeInk}: ${d.activeInk};`,
    `${v.activeFg}: ${d.activeFg};`,
    `${v.sep}: ${d.sep};`,
    `${v.radius}: ${d.radius};`,
    `${v.btn}: ${d.btn};`,
    `${v.shadow}: ${d.shadow};`,
    `${v.font}: ${d.font};`,
    `${v.customDefault}: ${d.customDefault};`,
  ].join("\n  ");
}
