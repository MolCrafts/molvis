/**
 * Number (and optional mass) density of atoms in the simulation cell.
 *
 * ρ_number = N / V (Å⁻³). Mass density uses 1 amu/Å³ = 1.66053906660 g/cm³
 * when a `mass` / `masses` column is present.
 */

import type { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { DType } from "../utils/dtype";

/** 1 amu / Å³ in g/cm³. */
export const AMU_PER_A3_TO_G_CM3 = 1.6605390666;

export type GlobalDensitySpecies = "all" | "each" | string;

export interface GlobalDensityRow {
  /** `all`, an element symbol, or `selection`. */
  label: string;
  nAtoms: number;
  /** Number density, Å⁻³. */
  numberDensity: number;
  /** Mass density, g/cm³, when masses are on the frame. */
  massDensity: number | null;
}

export interface GlobalDensityResult {
  volume: number;
  rows: GlobalDensityRow[];
}

export interface GlobalDensityOptions {
  species: GlobalDensitySpecies;
  /** Row indices into the atoms block; omit or empty means every atom. */
  selected?: readonly number[];
}

function floatCol(atoms: Block, keys: readonly string[]): Float64Array | null {
  for (const key of keys) {
    if (atoms.has(key) && atoms.dtype(key) === DType.F64) {
      return atoms.copy(key) as Float64Array;
    }
  }
  return null;
}

function symbols(atoms: Block, n: number): string[] {
  for (const key of ["element", "species"] as const) {
    if (atoms.has(key) && atoms.dtype(key) === DType.String) {
      return atoms.copy(key) as string[];
    }
  }
  return Array.from({ length: n }, () => "?");
}

function row(
  label: string,
  indices: readonly number[],
  masses: Float64Array | null,
  volume: number,
): GlobalDensityRow {
  const nAtoms = indices.length;
  let massSum = 0;
  let hasMass = masses !== null;
  if (masses) {
    for (const i of indices) {
      const m = masses[i];
      if (!Number.isFinite(m)) {
        hasMass = false;
        break;
      }
      massSum += m;
    }
  }
  return {
    label,
    nAtoms,
    numberDensity: nAtoms / volume,
    massDensity: hasMass ? (massSum / volume) * AMU_PER_A3_TO_G_CM3 : null,
  };
}

/**
 * ρ = N / V for the whole cell, a species, or each species, optionally
 * restricted to a row selection.
 *
 * @throws Error when the frame has no atoms, no cell, a non-positive volume,
 *   or the selection is empty.
 */
export function computeGlobalDensity(
  frame: Frame,
  options: GlobalDensityOptions,
): GlobalDensityResult {
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  const n = atoms?.nRows ?? 0;
  if (!atoms || n === 0) {
    throw new Error("No atoms in the frame");
  }
  const box = frame.box;
  if (!box) {
    throw new Error("Needs a simulation cell (box) to compute density");
  }
  const volume = box.volume();
  if (!(volume > 0) || !Number.isFinite(volume)) {
    throw new Error("Simulation cell volume is not a positive number");
  }

  const selected = options.selected;
  const pool =
    selected && selected.length > 0
      ? selected.filter((i) => i >= 0 && i < n)
      : Array.from({ length: n }, (_, i) => i);
  if (pool.length === 0) {
    throw new Error("No atoms in the selection");
  }

  const masses = floatCol(atoms, ["mass", "masses"]);
  const species = options.species;

  if (species === "all") {
    return { volume, rows: [row("all", pool, masses, volume)] };
  }

  const el = symbols(atoms, n);
  if (species === "each") {
    const groups = new Map<string, number[]>();
    for (const i of pool) {
      const key = el[i] || "?";
      const list = groups.get(key);
      if (list) list.push(i);
      else groups.set(key, [i]);
    }
    const labels = [...groups.keys()].sort();
    return {
      volume,
      rows: labels.map((label) =>
        row(label, groups.get(label) ?? [], masses, volume),
      ),
    };
  }

  const indices = pool.filter((i) => el[i] === species);
  if (indices.length === 0) {
    throw new Error(`No ${species} atoms in the current scope`);
  }
  return { volume, rows: [row(species, indices, masses, volume)] };
}
