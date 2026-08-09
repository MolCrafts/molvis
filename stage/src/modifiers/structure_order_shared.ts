/**
 * Shared helpers for structure → per-atom property → color modifiers.
 *
 * Column name conventions (stable for Color by Property / RPC / docs):
 * - Steinhardt: `steinhardt_q{l}`, optional `steinhardt_w{l}`
 * - Solid–liquid: `solid_liquid` (0/1), `solid_liquid_n_bonds`
 */

import {
  type Block,
  type Frame,
  Frame as MolrsFrame,
} from "@molcrafts/molvis-core/molrs";
import { getColorMap } from "../artist/palette";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "./ColorByPropertyModifier";

export const STEINHARDT_Q_PREFIX = "steinhardt_q";
export const STEINHARDT_W_PREFIX = "steinhardt_w";
export const SOLID_LIQUID_COLUMN = "solid_liquid";
export const SOLID_LIQUID_N_BONDS_COLUMN = "solid_liquid_n_bonds";

export function steinhardtQColumn(l: number): string {
  return `${STEINHARDT_Q_PREFIX}${l}`;
}

export function steinhardtWColumn(l: number): string {
  return `${STEINHARDT_W_PREFIX}${l}`;
}

/** Deep-copy frame blocks + box so we can inject new atom columns. */
export function cloneFrameWithAtoms(input: Frame): Frame | null {
  const atoms = input.getBlock("atoms");
  if (!atoms) return null;
  const result = new MolrsFrame();
  result.insertBlock("atoms", atoms);
  const bonds = input.getBlock("bonds");
  if (bonds) result.insertBlock("bonds", bonds);
  // Share box handle — ColorByProperty does the same; callers must not free it.
  if (input.box) result.box = input.box;
  return result;
}

export function writeAtomF64Column(
  atoms: Block,
  name: string,
  values: Float64Array | number[],
): void {
  const data =
    values instanceof Float64Array ? values : Float64Array.from(values);
  atoms.setColF(name, data);
}

/**
 * Inject viridis `__color_*` from a numeric atom column (Color by Property path).
 * `categorical` stringifies values (for 0/1 solid flags).
 */
export function applyColumnColors(
  atoms: Block,
  columnName: string,
  options?: { categorical?: boolean },
): void {
  const n = atoms.nrows();
  if (n === 0) return;
  const data = atoms.viewColF(columnName);
  if (!data || data.length < n) return;

  const colorR = new Float64Array(n);
  const colorG = new Float64Array(n);
  const colorB = new Float64Array(n);

  if (options?.categorical) {
    // Two-ish classes: map distinct values to discrete palette slots.
    const keys = Array.from(data, (v) => String(v));
    const unique = [...new Set(keys)];
    const palette = unique.map((_, i) => {
      const cm = getColorMap("viridis");
      if (cm.kind !== "continuous") return [0.5, 0.5, 0.5] as const;
      return cm.sample(unique.length <= 1 ? 0.5 : i / (unique.length - 1));
    });
    const index = new Map(unique.map((k, i) => [k, i]));
    for (let i = 0; i < n; i++) {
      const rgb = palette[index.get(keys[i]) ?? 0];
      colorR[i] = rgb[0];
      colorG[i] = rgb[1];
      colorB[i] = rgb[2];
    }
  } else {
    const cm = getColorMap("viridis");
    if (cm.kind !== "continuous") return;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min;
    const inv = span > 1e-12 ? 1 / span : 0;
    for (let i = 0; i < n; i++) {
      const t = Math.max(0, Math.min(1, (data[i] - min) * inv));
      const [r, g, b] = cm.sample(t);
      colorR[i] = r;
      colorG[i] = g;
      colorB[i] = b;
    }
  }

  atoms.setColF(COLOR_OVERRIDE_R, colorR);
  atoms.setColF(COLOR_OVERRIDE_G, colorG);
  atoms.setColF(COLOR_OVERRIDE_B, colorB);
}
