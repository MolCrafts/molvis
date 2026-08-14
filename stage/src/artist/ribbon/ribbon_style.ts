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
 *
 * Secondary-structure colors live on {@link RibbonStyle} (PyMOL-like
 * defaults). Chain / spectrum still use the categorical theme / viridis.
 */

import { categoricalColorAt, getColorMap, type LinearRGB } from "../palette";
import type { SecondaryStructureType } from "./pdb_backbone";

const SS_DEFAULT_HEX = {
  helix: "#E5533D",
  sheet: "#F0C419",
  coil: "#7DCE7A",
} as const;

export function displayRgbFromHex(hex: string): [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`invalid display hex color: ${hex}`);
  }
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function displayRgbToHex(
  rgb: readonly [number, number, number],
): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`.toUpperCase();
}

export type RibbonColorMode = "ss" | "spectrum" | "chain" | "uniform";

export interface RibbonStyle {
  /** How residues are colored along the ribbon. */
  readonly colorMode: RibbonColorMode;
  /** RGB triple (each in [0, 1]). Used iff `colorMode === "uniform"`. */
  readonly uniformColor: readonly [number, number, number];
  /**
   * Helix display sRGB in [0, 1]. Default `#E5533D`.
   */
  readonly helixColor: readonly [number, number, number];
  /**
   * Sheet display sRGB in [0, 1]. Default `#F0C419`.
   */
  readonly sheetColor: readonly [number, number, number];
  /**
   * Coil display sRGB in [0, 1]. Default `#7DCE7A`.
   */
  readonly coilColor: readonly [number, number, number];
  /** Multiplier on each SS profile's nominal width. 1.0 = default. */
  readonly widthScale: number;
  /** Spline subdivisions per residue. Higher = smoother, more verts. */
  readonly smoothness: number;
  /** Material opacity in [0, 1]. 1 = fully opaque. */
  readonly opacity: number;
}

/**
 * Palette stores linear RGB (same as atom impostor buffers). Ribbon
 * meshes use StandardMaterial vertex colors, which are treated as
 * display/sRGB — convert so swatches match the palette UI.
 */
function linearToDisplay(rgb: LinearRGB): [number, number, number] {
  const conv = (c: number) => {
    const x = Math.min(1, Math.max(0, c));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return [conv(rgb[0]), conv(rgb[1]), conv(rgb[2])];
}

const DEFAULT_HELIX = displayRgbFromHex(SS_DEFAULT_HEX.helix);
const DEFAULT_SHEET = displayRgbFromHex(SS_DEFAULT_HEX.sheet);
const DEFAULT_COIL = displayRgbFromHex(SS_DEFAULT_HEX.coil);

export const DEFAULT_RIBBON_STYLE: RibbonStyle = {
  colorMode: "chain",
  uniformColor: DEFAULT_COIL,
  helixColor: DEFAULT_HELIX,
  sheetColor: DEFAULT_SHEET,
  coilColor: DEFAULT_COIL,
  widthScale: 0.95,
  smoothness: 14,
  opacity: 1.0,
};

/** SS color from the style snapshot (display/sRGB). */
export function ssColor(
  ss: SecondaryStructureType,
  style: RibbonStyle = DEFAULT_RIBBON_STYLE,
): [number, number, number] {
  const rgb =
    ss === "helix"
      ? style.helixColor
      : ss === "sheet"
        ? style.sheetColor
        : style.coilColor;
  return [rgb[0], rgb[1], rgb[2]];
}

/**
 * Per-chain color — same ordinal path as type rails / legends
 * (`categoricalColorAt`), in display/sRGB for the ribbon material.
 */
export function chainColor(chainIndex: number): [number, number, number] {
  return linearToDisplay(categoricalColorAt(Math.max(0, chainIndex)));
}

/**
 * N→C spectrum via the internal continuous `viridis` ramp (same map used
 * for numeric property coloring). `t` is in [0, 1]. Display/sRGB.
 */
export function spectrumColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  return linearToDisplay(getColorMap("viridis").sample(clamped));
}
