/**
 * Public palettes:
 * - element lookups (`cpk`, `vivid`); internal OVITO CPK is `ovito-elements`
 * - categorical type colors (`ovito`, nine OVITO default type swatches)
 *
 * Tab10 / Ovito assignment algorithms live in {@link Tab10Strategy} /
 * {@link OvitoStrategy}. Numeric property coloring uses a single internal
 * continuous ramp (`viridis`).
 */

import {
  bindOvitoElementHex,
  OVITO_TYPE_COLORS,
  Tab10Strategy,
} from "./categorical_theme";
import {
  compareNaturalKeys,
  compareTextTokens,
  stableStringHash,
} from "./palette_keys";

export {
  compareNaturalKeys,
  compareTextTokens,
  OVITO_TYPE_COLORS,
  stableStringHash,
};
export type LinearRGB = [number, number, number];
export type ColorMapKind = "continuous" | "categorical" | "lookup";
export type PaletteKind = "element" | "categorical";

export interface PaletteEntry {
  label: string;
  color: string;
}

export interface PaletteSummary {
  name: string;
  kind: PaletteKind;
  size: number;
}

export interface PaletteDefinition extends PaletteSummary {
  entries: PaletteEntry[];
}

const INTERNAL_NUMERIC_COLOR_MAP = "viridis";

// ============================================================================
// Inline palette data
// ============================================================================

const CPK_RECORD = {
  Ac: "#70ABFA",
  Ag: "#C0C0C0",
  Al: "#BFA6A6",
  Am: "#545CF2",
  Ar: "#80D1E3",
  As: "#BD80E3",
  At: "#754F45",
  Au: "#FFD123",
  B: "#FFB5B5",
  Ba: "#00C900",
  Be: "#C2FF00",
  Bh: "#E00038",
  Bi: "#9E4FB5",
  Bk: "#8A4FE3",
  Br: "#A62929",
  // Jmol CPK carbon — medium neutral grey (not the bright cool silver that
  // washes out next to white hydrogens on a dark canvas).
  C: "#909090",
  Ca: "#3DFF00",
  Cd: "#FFD98F",
  Ce: "#FFFFC7",
  Cf: "#A136D4",
  Cl: "#1FF01F",
  Cm: "#785CE3",
  Cn: "#FF1493",
  Co: "#F090A0",
  Cr: "#8A99C7",
  Cs: "#57178F",
  Cu: "#C88033",
  Db: "#D1004F",
  Ds: "#FF1493",
  Dy: "#1FFFC7",
  Er: "#00E675",
  Es: "#B31FD4",
  Eu: "#61FFC7",
  F: "#90E050",
  Fe: "#E06633",
  Fl: "#FF1493",
  Fm: "#B31FBA",
  Fr: "#420066",
  Ga: "#C28F8F",
  Gd: "#45FFC7",
  Ge: "#668F8F",
  H: "#FFFFFF",
  He: "#D9FFFF",
  Hf: "#4DC2FF",
  Hg: "#B8B8D0",
  Ho: "#00FF9C",
  Hs: "#E6002E",
  I: "#940094",
  In: "#A67573",
  Ir: "#175487",
  K: "#8F40D4",
  Kr: "#5CB8D1",
  La: "#70D4FF",
  Li: "#CC80FF",
  Lr: "#C70066",
  Lu: "#00AB24",
  Lv: "#FF1493",
  Mc: "#FF1493",
  Md: "#B30DA6",
  Mg: "#8AFF00",
  Mn: "#9C7AC7",
  Mo: "#54B5B5",
  Mt: "#EB0026",
  N: "#3050F8",
  Na: "#AB5CF2",
  Nb: "#73C2C9",
  Nd: "#C7FFC7",
  Ne: "#B3E3F5",
  Nh: "#FF1493",
  Ni: "#50D050",
  No: "#BD0D87",
  Np: "#0080FF",
  O: "#FF0D0D",
  Og: "#FF1493",
  Os: "#266696",
  P: "#FF8000",
  Pa: "#00A1FF",
  Pb: "#575961",
  Pd: "#006985",
  Pm: "#A3FFC7",
  Po: "#AB5C00",
  Pr: "#D9FFC7",
  Pt: "#D0D0E0",
  Pu: "#006BFF",
  Ra: "#007D00",
  Rb: "#702EB0",
  Re: "#267DAB",
  Rf: "#CC0059",
  Rg: "#FF1493",
  Rh: "#0A7D8C",
  Rn: "#428296",
  Ru: "#248F8F",
  S: "#FFFF30",
  Sb: "#9E63B5",
  Sc: "#E6E6E6",
  Se: "#FFA100",
  Sg: "#D90045",
  Si: "#F0C8A0",
  Sm: "#8FFFC7",
  Sn: "#668080",
  Sr: "#00FF00",
  Ta: "#4DA6FF",
  Tb: "#30FFC7",
  Tc: "#3B9E9E",
  Te: "#D47A00",
  Th: "#00BAFF",
  Ti: "#BFC2C7",
  Tl: "#A6544D",
  Tm: "#00D452",
  Ts: "#FF1493",
  U: "#008FFF",
  V: "#A6A6AB",
  W: "#2194D6",
  Xe: "#429EB0",
  Y: "#94FFFF",
  Yb: "#00BF38",
  Zn: "#7D80B0",
  Zr: "#94E0E0",
} as const;

const OVITO_RECORD = {
  Ac: "#70ABFA",
  Ag: "#E0E0FF",
  Al: "#BFA6A6",
  Am: "#545CF2",
  Ar: "#80D1E3",
  As: "#BD80E3",
  At: "#754F45",
  Au: "#FFD123",
  B: "#FFB5B5",
  Ba: "#00C900",
  Be: "#C2FF00",
  Bh: "#E07A33",
  Bi: "#9E4FB5",
  Bk: "#E3AB35",
  Br: "#A62929",
  C: "#909090",
  Ca: "#3DFF00",
  Cd: "#FFD98F",
  Ce: "#FFFFC7",
  Cf: "#EB3333",
  Cl: "#1FF01F",
  Cm: "#F24D4D",
  Cn: "#BF7878",
  Co: "#F090A0",
  Cr: "#8A99C7",
  Cs: "#57178F",
  Cu: "#C88033",
  Db: "#D1824F",
  Ds: "#E04538",
  Dy: "#1FFFC7",
  Er: "#00E675",
  Es: "#EB4F59",
  Eu: "#61FFC7",
  F: "#80B3FF",
  Fe: "#E06633",
  Fl: "#A38594",
  Fm: "#E64D4D",
  Fr: "#420066",
  Ga: "#C28F8F",
  Gd: "#45FFC7",
  Ge: "#668F8F",
  H: "#FFFFFF",
  He: "#D9FFFF",
  Hf: "#4DC2FF",
  Hg: "#B5B5C2",
  Ho: "#00FF9C",
  Hs: "#E64D4D",
  I: "#940094",
  In: "#A67573",
  Ir: "#175487",
  K: "#8F40D4",
  Kr: "#5CB8D1",
  La: "#70D4FF",
  Li: "#CC80FF",
  Lr: "#C27D69",
  Lu: "#00AB24",
  Lv: "#878CAB",
  Mc: "#998CAB",
  Md: "#D17D33",
  Mg: "#8AFF00",
  Mn: "#9C7AC7",
  Mo: "#54B5B5",
  Mt: "#EB4A33",
  N: "#3050F8",
  Na: "#AB5CF2",
  Nb: "#4DB376",
  Nd: "#C7FFC7",
  Ne: "#B3E3F5",
  Nh: "#B37D82",
  Ni: "#50D050",
  No: "#C78033",
  Np: "#D49EEB",
  O: "#FF0D0D",
  Og: "#666666",
  Os: "#266696",
  P: "#FF8000",
  Pa: "#CCE0FA",
  Pb: "#575961",
  Pd: "#006985",
  Pm: "#A3FFC7",
  Po: "#AB5C00",
  Pr: "#D9FFC7",
  Pt: "#E6D9AD",
  Pu: "#D1ADC7",
  Ra: "#007DAB",
  Rb: "#702EB0",
  Re: "#267DAB",
  Rf: "#CC9933",
  Rg: "#D14D52",
  Rh: "#0A7D8C",
  Rn: "#428296",
  Ru: "#248F8F",
  S: "#B3B300",
  Sb: "#9E63B5",
  Sc: "#E6E6E6",
  Se: "#FFA100",
  Sg: "#D9784F",
  Si: "#F0C8A0",
  Sm: "#8FFFC7",
  Sn: "#668080",
  Sr: "#00FF27",
  Ta: "#4DA6FF",
  Tb: "#30FFC7",
  Tc: "#3B9E9E",
  Te: "#D47A00",
  Th: "#BAC7DE",
  Ti: "#BFC2C7",
  Tl: "#A6544D",
  Tm: "#00D452",
  Ts: "#758FAB",
  U: "#1F94D4",
  V: "#A6A6AB",
  W: "#2194D6",
  Xe: "#429EB0",
  Y: "#67998F",
  Yb: "#00BF38",
  Zn: "#7D80B0",
  Zr: "#00FF00",
} as const;

// ---------------------------------------------------------------------------
//  vivid — a brighter, livelier element palette derived from CPK. Tuned to
//  read well on a dark canvas: dull/dark elements are lifted toward a luminous
//  mid band and harsh fully-saturated ones are softened slightly, so the
//  result is vibrant without being garish. The elements that dominate real
//  structures are hand-tuned; the long tail is derived from CPK by the same
//  lift-and-soften rule (`vividize`).
// ---------------------------------------------------------------------------

function hexToHsl(hex: string): [number, number, number] {
  const h0 = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = Number.parseInt(h0.slice(0, 2), 16) / 255;
  const g = Number.parseInt(h0.slice(2, 4), 16) / 255;
  const b = Number.parseInt(h0.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r = l;
  let g = l;
  let b = l;
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** Lift a CPK color into the vivid band: raise lightness toward a luminous
 *  mid-tone (so dark/dull elements pop) and gently cap saturation (so nothing
 *  turns neon). Hand overrides below win for the common elements. */
function vividize(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  const s2 = Math.min(0.8, s * 0.9);
  const l2 = Math.min(0.82, Math.max(0.45, 0.5 + (l - 0.5) * 0.6 + 0.06));
  return hslToHex(h, s2, l2);
}

// Hand-tuned soft-vivid colors for the elements that dominate real structures.
// H stays pure white; C stays Jmol-grey so organics read as skeleton + white
// hydrogens rather than two near-identical cool silvers.
const VIVID_OVERRIDES: Record<string, string> = {
  H: "#FFFFFF",
  He: "#C7F2F2",
  Li: "#D49CFF",
  B: "#FFB0B0",
  C: "#909090",
  N: "#5B7BFF",
  O: "#FF5A5A",
  F: "#8FE36B",
  Ne: "#BEE9F7",
  Na: "#B97CF5",
  Mg: "#97E84A",
  Al: "#D9BABA",
  Si: "#F2CE9A",
  P: "#FF9B45",
  S: "#FFD740",
  Cl: "#5FD86F",
  Ar: "#8FD9E6",
  K: "#9E5CE6",
  Ca: "#6FE34F",
  Fe: "#EE7B43",
  Co: "#F2A0AE",
  Ni: "#62D662",
  Cu: "#DC8E4A",
  Zn: "#969AD0",
  Br: "#D2554F",
  I: "#B45FD6",
  Au: "#FFD84D",
  Ag: "#D6D6E6",
};

const VIVID_RECORD: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [el, hex] of Object.entries(CPK_RECORD)) {
    out[el] = VIVID_OVERRIDES[el] ?? vividize(hex);
  }
  return out;
})();

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToLinearRgb(hex: string): LinearRGB {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = Number.parseInt(h.slice(0, 2), 16) / 255;
  const g = Number.parseInt(h.slice(2, 4), 16) / 255;
  const b = Number.parseInt(h.slice(4, 6), 16) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function linearRgbToHex(rgb: LinearRGB): string {
  const [r, g, b] = rgb;
  const toHex = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    const srgb = linearToSrgb(clamped);
    const byte = Math.round(srgb * 255);
    return byte.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** HSL (h in degrees, s/l in [0,1]) → sRGB [0,1] triplet. */

/**
 * Relative luminance of an sRGB hex (WCAG), 0–1.
 */
export function relativeLuminanceHex(hex: string): number {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const toLin = (byte: number) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = toLin(Number.parseInt(h.slice(0, 2), 16));
  const g = toLin(Number.parseInt(h.slice(2, 4), 16));
  const b = toLin(Number.parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Categorical color for a fixed ordinal (0-based) — UI rails, legends, and the
 * secondary-structure colors, all of which pin an ordinal and want the same
 * color every time.
 */
export function categoricalColorAt(
  ordinal: number,
  strategy?: import("./categorical_theme").CategoricalColorStrategy,
): LinearRGB {
  const i = Math.max(0, ordinal);
  return hexToLinearRgb((strategy ?? DEFAULT_TAB10).colorAt("", i));
}

export class ColorMap {
  readonly name: string;
  readonly kind: ColorMapKind;

  private readonly _palette: LinearRGB[];
  private readonly _lookup: Map<string, LinearRGB>;
  private readonly _fallback: LinearRGB | null;

  private constructor(
    name: string,
    palette: LinearRGB[],
    kind: ColorMapKind,
    lookup?: Map<string, LinearRGB>,
    fallback?: LinearRGB | null,
  ) {
    this.name = name;
    this._palette = palette;
    this.kind = kind;
    this._lookup = lookup ?? new Map();
    this._fallback = fallback ?? null;
  }

  get colors(): readonly LinearRGB[] {
    return this._palette;
  }

  sample(t: number): LinearRGB {
    if (this.kind !== "continuous") {
      throw new Error(`Colormap '${this.name}' does not support sampling`);
    }

    const n = this._palette.length;
    if (n === 0) return [0, 0, 0];
    if (n === 1) return this._palette[0];

    const clamped = Math.max(0, Math.min(1, t));
    const scaled = clamped * (n - 1);
    const i = Math.floor(scaled);
    const frac = scaled - i;

    if (i >= n - 1) return this._palette[n - 1];

    const a = this._palette[i];
    const b = this._palette[i + 1];
    return [
      a[0] + (b[0] - a[0]) * frac,
      a[1] + (b[1] - a[1]) * frac,
      a[2] + (b[2] - a[2]) * frac,
    ];
  }

  colorForKey(key: string): LinearRGB {
    const looked = this._lookup.get(key);
    if (looked) return looked;

    if (this.kind === "lookup") {
      return this._fallback ?? [1, 0, 1];
    }

    if (this._palette.length === 0) {
      return [0, 0, 0];
    }

    const raw = stableStringHash(key) / 0xffffffff;
    const t = 0.1 + raw * 0.8;
    return this.sample(t);
  }

  static fromLookup(
    name: string,
    record: Record<string, string>,
    fallback = "#FF00FF",
  ): ColorMap {
    const lookup = new Map<string, LinearRGB>();
    const palette: LinearRGB[] = [];
    for (const [key, hex] of Object.entries(record)) {
      const rgb = hexToLinearRgb(hex);
      lookup.set(key, rgb);
      palette.push(rgb);
    }
    return new ColorMap(
      name,
      palette,
      "lookup",
      lookup,
      hexToLinearRgb(fallback),
    );
  }

  static fromPalette(name: string, hexColors: readonly string[]): ColorMap {
    const palette = hexColors.map(hexToLinearRgb);
    return new ColorMap(name, palette, "categorical");
  }

  static fromLUT(name: string, lut: Float32Array): ColorMap {
    const n = lut.length / 3;
    const palette: LinearRGB[] = new Array(n);
    for (let i = 0; i < n; i++) {
      palette[i] = [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]];
    }
    return new ColorMap(name, palette, "continuous");
  }
}

const REGISTRY = new Map<string, ColorMap>();
const PUBLIC_COLOR_MAPS = new Set<string>();
const PUBLIC_PALETTE_DEFINITIONS = new Map<string, PaletteDefinition>();

function register(cm: ColorMap, options?: { public?: boolean }): void {
  REGISTRY.set(cm.name, cm);
  if (options?.public ?? cm.kind !== "continuous") {
    PUBLIC_COLOR_MAPS.add(cm.name);
  }

  // Rebuild palette definition from ColorMap
  if (cm.kind === "lookup") {
    // For lookup ColorMaps, we need the original record to get labels and preserve order
    // This is handled separately when registering cpk and ovito
  } else if (cm.kind === "categorical") {
    // For categorical ColorMaps, labels are "1"…"N"
    const entries: PaletteEntry[] = cm.colors.map((rgb, i) => ({
      label: String(i + 1),
      color: linearRgbToHex(rgb),
    }));
    PUBLIC_PALETTE_DEFINITIONS.set(cm.name, {
      name: cm.name,
      kind: "categorical",
      size: entries.length,
      entries,
    });
  }
}

export function getColorMap(name: string): ColorMap {
  const cm = REGISTRY.get(name);
  if (!cm) {
    const available = Array.from(REGISTRY.keys()).sort().join(", ");
    throw new Error(`Unknown colormap '${name}'. Available: ${available}`);
  }
  return cm;
}

export function listColorMaps(): string[] {
  return Array.from(PUBLIC_COLOR_MAPS).sort();
}

export function listPaletteDefinitions(): PaletteSummary[] {
  return Array.from(PUBLIC_PALETTE_DEFINITIONS.values())
    .map(({ entries, ...summary }) => ({
      ...summary,
      size: entries.length,
    }))
    .sort((a, b) => compareTextTokens(a.name, b.name));
}

export function getPaletteDefinition(name: string): PaletteDefinition {
  const definition = PUBLIC_PALETTE_DEFINITIONS.get(name);
  if (!definition) {
    const available = Array.from(PUBLIC_PALETTE_DEFINITIONS.keys())
      .sort()
      .join(", ");
    throw new Error(`Unknown palette '${name}'. Available: ${available}`);
  }
  return {
    ...definition,
    entries: definition.entries.map((entry) => ({ ...entry })),
  };
}

export function listContinuousColorMaps(): string[] {
  const names: string[] = [];
  for (const cm of REGISTRY.values()) {
    if (cm.kind === "continuous") names.push(cm.name);
  }
  return names.sort();
}

export interface CategoricalLookupOptions {
  /** Product theme strategy. Defaults to {@link Tab10Strategy}. */
  strategy?: import("./categorical_theme").CategoricalColorStrategy;
  /** Optional type-id map for {@link OvitoStrategy}. */
  numericIds?: ReadonlyMap<string, number>;
}

const DEFAULT_TAB10 = new Tab10Strategy();

/**
 * Assign one colour per distinct key via the current categorical strategy.
 */
export function buildCategoricalColorLookup(
  keys: Iterable<string>,
  options: CategoricalLookupOptions = {},
): Map<string, LinearRGB> {
  const strategy = options.strategy ?? DEFAULT_TAB10;
  const hexes = strategy.colorForKeys(keys, options.numericIds);
  const lookup = new Map<string, LinearRGB>();
  for (const [key, hex] of hexes) {
    lookup.set(key, hexToLinearRgb(hex));
  }
  return lookup;
}

/**
 * Build a source→color legend for a set of numeric source ids (e.g. the
 * `source_id` column emitted by loader-time extend). Returns one entry per
 * DISTINCT id in ascending order; each `hex` is the categorical-palette color
 * for that id's ordinal as an uppercase `#RRGGBB` string — the same mapping
 * {@link buildCategoricalColorLookup} assigns, so the legend matches what the
 * renderer shows.
 */
export function buildSourceColorLegend(
  sourceIds: number[],
  options: CategoricalLookupOptions = {},
): Array<{ sourceId: number; hex: string }> {
  const distinct = Array.from(new Set(sourceIds)).sort((a, b) => a - b);
  const lookup = buildCategoricalColorLookup(
    distinct.map((id) => String(id)),
    options,
  );
  return distinct.map((sourceId) => ({
    sourceId,
    hex: linearRgbToHex(lookup.get(String(sourceId)) ?? [0, 0, 0]),
  }));
}

function lut(data: number[]): Float32Array {
  return Float32Array.from(data);
}

function registerLookup(
  name: string,
  record: Record<string, string>,
  fallback?: string,
  orderedKeys?: string[],
): void {
  const cm = ColorMap.fromLookup(name, record, fallback);
  register(cm, { public: true });

  // Store palette definition for public lookup
  // Use provided order or fall back to alphabetical (Object.entries preserves insertion order in modern JS)
  const keys = orderedKeys ?? Object.keys(record).sort();
  const entries: PaletteEntry[] = keys.map((label) => ({
    label,
    color: record[label],
  }));
  PUBLIC_PALETTE_DEFINITIONS.set(name, {
    name,
    kind: "element",
    size: entries.length,
    entries,
  });
}

// ============================================================================
// Initialization: register all palettes
// ============================================================================

// Ordered element symbols (H first, then periodic table order)
const ELEMENT_ORDER = [
  "H",
  "He",
  "Li",
  "Be",
  "B",
  "C",
  "N",
  "O",
  "F",
  "Ne",
  "Na",
  "Mg",
  "Al",
  "Si",
  "P",
  "S",
  "Cl",
  "Ar",
  "K",
  "Ca",
  "Sc",
  "Ti",
  "V",
  "Cr",
  "Mn",
  "Fe",
  "Co",
  "Ni",
  "Cu",
  "Zn",
  "Ga",
  "Ge",
  "As",
  "Se",
  "Br",
  "Kr",
  "Rb",
  "Sr",
  "Y",
  "Zr",
  "Nb",
  "Mo",
  "Tc",
  "Ru",
  "Rh",
  "Pd",
  "Ag",
  "Cd",
  "In",
  "Sn",
  "Sb",
  "Te",
  "I",
  "Xe",
  "Cs",
  "Ba",
  "La",
  "Ce",
  "Pr",
  "Nd",
  "Pm",
  "Sm",
  "Eu",
  "Gd",
  "Tb",
  "Dy",
  "Ho",
  "Er",
  "Tm",
  "Yb",
  "Lu",
  "Hf",
  "Ta",
  "W",
  "Re",
  "Os",
  "Ir",
  "Pt",
  "Au",
  "Hg",
  "Tl",
  "Pb",
  "Bi",
  "Po",
  "At",
  "Rn",
  "Fr",
  "Ra",
  "Ac",
  "Th",
  "Pa",
  "U",
  "Np",
  "Pu",
  "Am",
  "Cm",
  "Bk",
  "Cf",
  "Es",
  "Fm",
  "Md",
  "No",
  "Lr",
  "Rf",
  "Db",
  "Sg",
  "Bh",
  "Hs",
  "Mt",
  "Ds",
  "Rg",
  "Cn",
  "Nh",
  "Fl",
  "Mc",
  "Lv",
  "Ts",
  "Og",
];

// Register cpk (118 elements). Unknown/unmapped elements fall back to white
// rather than the default magenta — a neutral atom reads better against the
// dark canvas than a saturated "missing" marker.
registerLookup("cpk", CPK_RECORD, "#FFFFFF", ELEMENT_ORDER);

export const OVITO_ELEMENT_HEX = OVITO_RECORD;
bindOvitoElementHex(OVITO_ELEMENT_HEX);

// Internal 118-element OVITO CPK table — not a public palette name.
registerLookup("ovito-elements", OVITO_RECORD, "#CCCCCC", ELEMENT_ORDER);
PUBLIC_COLOR_MAPS.delete("ovito-elements");
PUBLIC_PALETTE_DEFINITIONS.delete("ovito-elements");

register(ColorMap.fromPalette("ovito", OVITO_TYPE_COLORS));
PUBLIC_PALETTE_DEFINITIONS.set("ovito", {
  name: "ovito",
  kind: "categorical",
  size: OVITO_TYPE_COLORS.length,
  entries: OVITO_TYPE_COLORS.map((color, i) => ({
    label: String(i),
    color,
  })),
});

// Register vivid (brighter, livelier default element palette). Unknown
// elements fall back to a bright neutral grey rather than white.
registerLookup("vivid", VIVID_RECORD, "#CDD2DA", ELEMENT_ORDER);

// Register viridis (internal, continuous, not public)
register(
  ColorMap.fromLUT(
    INTERNAL_NUMERIC_COLOR_MAP,
    lut([
      0.058, 0.0, 0.089, 0.062, 0.004, 0.116, 0.065, 0.009, 0.145, 0.065, 0.017,
      0.173, 0.063, 0.027, 0.202, 0.059, 0.039, 0.223, 0.054, 0.053, 0.239,
      0.048, 0.069, 0.251, 0.042, 0.089, 0.26, 0.036, 0.109, 0.266, 0.032, 0.13,
      0.269, 0.028, 0.152, 0.271, 0.024, 0.179, 0.272, 0.021, 0.205, 0.272,
      0.018, 0.232, 0.27, 0.016, 0.262, 0.267, 0.014, 0.298, 0.261, 0.013,
      0.332, 0.252, 0.014, 0.368, 0.24, 0.018, 0.406, 0.225, 0.027, 0.45, 0.203,
      0.042, 0.49, 0.181, 0.064, 0.531, 0.157, 0.097, 0.571, 0.131, 0.149,
      0.614, 0.102, 0.211, 0.65, 0.076, 0.291, 0.682, 0.053, 0.39, 0.711, 0.034,
      0.525, 0.739, 0.018, 0.665, 0.76, 0.01, 0.82, 0.78, 0.01, 0.985, 0.8,
      0.018,
    ]),
  ),
  { public: false },
);
