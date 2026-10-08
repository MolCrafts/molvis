import { type Box, Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";

/**
 * Clone `frame` with replaced atom x/y/z (or xu/yu/zu) columns.
 * Preserves bonds, other blocks, and box. Returns `input` if coords missing.
 */
export function frameWithCoords(
  input: Frame,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
): Frame {
  if (!input.has("atoms")) return input;
  const atoms = input.get("atoms");
  const coords = viewAtomCoords(atoms);
  if (!coords?.x || !coords.y || !coords.z) return input;

  const result = new Frame();
  result.set("atoms", atoms);
  if (!result.has("atoms")) return input;
  const resultAtoms = result.get("atoms");

  resultAtoms.set(coords.columns.x, x);
  resultAtoms.set(coords.columns.y, y);
  resultAtoms.set(coords.columns.z, z);

  const bonds = input.has("bonds") ? input.get("bonds") : undefined;
  if (bonds) result.set("bonds", bonds);

  for (const name of input.keys()) {
    if (name === "atoms" || name === "bonds") continue;
    const block = input.has(name) ? input.get(name) : undefined;
    if (block) result.set(name, block);
  }

  const box = input.box;
  if (box !== undefined) result.box = box;
  return result;
}

export function readAtomCoords(frame: Frame): {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  columns: { x: string; y: string; z: string };
  n: number;
} | null {
  if (!frame.has("atoms")) return null;
  const atoms = frame.get("atoms");
  const coords = viewAtomCoords(atoms);
  if (!coords?.x || !coords.y || !coords.z) return null;
  return {
    x: coords.x,
    y: coords.y,
    z: coords.z,
    columns: coords.columns,
    n: atoms.nRows,
  };
}

export function frameBox(frame: Frame): Box | undefined {
  return frame.box;
}
