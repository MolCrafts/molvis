/**
 * Per-atom van der Waals radii for surface construction.
 *
 * Kept free of molrs types on purpose — like {@link ../marching_cubes}, this
 * consumes plain arrays so it is testable without a WASM frame. Reading the
 * `element` column off a `Block` is the modifier's job.
 *
 * The probe radius is **not** applied here: SAS/SES add it on top of these
 * values, and a class that both looks up vdW radii and knows about solvent
 * probes would be doing two jobs.
 */

import {
  getVanDerWaalsRadius,
  normalizeElement,
} from "@molcrafts/molvis-core/elements";

/** Radius used when a frame carries no `element` column, Å. */
export const FALLBACK_RADIUS = 1.7;

/**
 * Which radius table sizes the atoms.
 *
 * `tkatchenko` is the table Spacefill draws with (Charry & Tkatchenko 2024).
 * `bondi` is Bondi (J. Phys. Chem. 1964, 68, 441), the set free-volume and
 * pore-size codes (Zeo++, PoreBlazer, the Bondi FFV) use; a pore surface
 * drawn beside those numbers has to use the same radii or it shows a
 * different void.
 */
export const RADIUS_SETS = ["tkatchenko", "bondi"] as const;
export type RadiusSet = (typeof RADIUS_SETS)[number];

/** Bondi 1964 van der Waals radii, Å. */
export const BONDI_RADII: Readonly<Record<string, number>> = {
  H: 1.2,
  He: 1.4,
  Li: 1.82,
  C: 1.7,
  N: 1.55,
  O: 1.52,
  F: 1.47,
  Ne: 1.54,
  Na: 2.27,
  Mg: 1.73,
  Si: 2.1,
  P: 1.8,
  S: 1.8,
  Cl: 1.75,
  Ar: 1.88,
  K: 2.75,
  Ni: 1.63,
  Cu: 1.4,
  Zn: 1.39,
  Ga: 1.87,
  As: 1.85,
  Se: 1.9,
  Br: 1.85,
  Kr: 2.02,
  Pd: 1.63,
  Ag: 1.72,
  Cd: 1.58,
  In: 1.93,
  Sn: 2.17,
  Te: 2.06,
  I: 1.98,
  Xe: 2.16,
  Pt: 1.72,
  Au: 1.66,
  Hg: 1.55,
  Tl: 1.96,
  Pb: 2.02,
  U: 1.86,
};

export interface AtomRadiiOptions {
  /** Multiplier on the tabulated vdW radius. 1 = unscaled. */
  scale: number;
  /** Radius table; `tkatchenko` when omitted. */
  set?: RadiusSet;
}

/**
 * Construct from an element column (or nothing), then read `values` / `max`.
 *
 * When `elements` is undefined or the wrong length, every atom takes
 * {@link FALLBACK_RADIUS} and {@link usedFallback} reports it, so the panel
 * can say "using uniform radius" instead of quietly drawing a carbon-shaped
 * surface over a metal cluster.
 */
export class AtomRadii {
  readonly values: Float64Array;
  readonly max: number;
  readonly usedFallback: boolean;
  /** Elements the requested table lacks, sized from `tkatchenko` instead. */
  readonly missing: readonly string[];

  constructor(
    count: number,
    elements: readonly string[] | undefined,
    options: AtomRadiiOptions,
  ) {
    const scale = Math.max(1e-3, options.scale);
    const usable = elements !== undefined && elements.length >= count;
    const bondi = options.set === "bondi";
    const missing = new Set<string>();
    const values = new Float64Array(count);
    let max = 0;
    for (let i = 0; i < count; i++) {
      const base = usable
        ? bondi
          ? bondiRadius(elements[i], missing)
          : getVanDerWaalsRadius(elements[i])
        : FALLBACK_RADIUS;
      const r = base * scale;
      values[i] = r;
      if (r > max) max = r;
    }
    this.values = values;
    this.max = max;
    this.usedFallback = !usable;
    this.missing = [...missing];
  }
}

function bondiRadius(element: string, missing: Set<string>): number {
  const symbol = normalizeElement(element);
  const r = BONDI_RADII[symbol];
  if (r !== undefined) return r;
  missing.add(symbol);
  return getVanDerWaalsRadius(symbol);
}
