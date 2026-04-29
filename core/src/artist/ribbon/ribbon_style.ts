/**
 * User-tunable ribbon appearance — passed from `DrawRibbonModifier`
 * down to the `RibbonRenderer` on every redraw.
 *
 * The cross-section *shape* (helix oval, sheet flat, coil tube) is
 * deliberately not exposed: those ratios encode the
 * structural-biology consensus on how a cartoon should be read,
 * and arbitrary tuning makes the figure scientifically dishonest.
 * Width *scale* (uniform multiplier) is exposed because that's a
 * presentation knob — it changes density of ink, not which atoms
 * a given visual shape implies.
 */

export type RibbonColorMode = "ss" | "spectrum" | "chain" | "uniform";

export interface RibbonStyle {
  /** How residues are colored along the ribbon. */
  readonly colorMode: RibbonColorMode;
  /** RGB triple (each in [0, 1]). Used iff `colorMode === "uniform"`. */
  readonly uniformColor: readonly [number, number, number];
  /** Multiplier on each SS profile's nominal width. 1.0 = default. */
  readonly widthScale: number;
  /** Spline subdivisions per residue. Higher = smoother, more verts. */
  readonly smoothness: number;
  /** Material opacity in [0, 1]. 1 = fully opaque. */
  readonly opacity: number;
}

export const DEFAULT_RIBBON_STYLE: RibbonStyle = {
  colorMode: "spectrum",
  uniformColor: [0.55, 0.55, 0.6],
  widthScale: 1.0,
  smoothness: 12,
  opacity: 1.0,
};

/**
 * Convert a normalized hue (`h` in [0, 1)) into an RGB triple in
 * [0, 1]. Saturation 0.85, lightness 0.55 — middle of the
 * "high-impact but not garish" zone for cartoon ribbons.
 */
export function hueToRgb(h: number): [number, number, number] {
  const s = 0.85;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 1 / 6) {
    r = c;
    g = x;
  } else if (h < 2 / 6) {
    r = x;
    g = c;
  } else if (h < 3 / 6) {
    g = c;
    b = x;
  } else if (h < 4 / 6) {
    g = x;
    b = c;
  } else if (h < 5 / 6) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [r + m, g + m, b + m];
}

/**
 * Deterministic palette for `colorMode === "chain"`. Picked from the
 * Okabe-Ito colour-blind safe set so multi-chain figures stay
 * readable for everyone.
 */
const CHAIN_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0.9, 0.6, 0.0], // orange
  [0.35, 0.7, 0.9], // sky blue
  [0.0, 0.6, 0.5], // bluish green
  [0.95, 0.9, 0.25], // yellow
  [0.0, 0.45, 0.7], // blue
  [0.8, 0.4, 0.0], // vermillion
  [0.8, 0.6, 0.7], // reddish purple
  [0.6, 0.6, 0.6], // gray
];

export function chainColor(chainIndex: number): [number, number, number] {
  const c = CHAIN_PALETTE[chainIndex % CHAIN_PALETTE.length];
  return [c[0], c[1], c[2]];
}
