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
  const atoms = input.getBlock("atoms");
  if (!atoms) return input;
  const coords = viewAtomCoords(atoms);
  if (!coords?.x || !coords.y || !coords.z) return input;

  const result = new Frame();
  result.insertBlock("atoms", atoms);
  const resultAtoms = result.getBlock("atoms");
  if (!resultAtoms) return input;

  resultAtoms.setColF(coords.columns.x, x);
  resultAtoms.setColF(coords.columns.y, y);
  resultAtoms.setColF(coords.columns.z, z);

  const bonds = input.getBlock("bonds");
  if (bonds) result.insertBlock("bonds", bonds);

  for (const name of input.blockNames()) {
    if (name === "atoms" || name === "bonds") continue;
    const block = input.getBlock(name);
    if (block) result.insertBlock(name, block);
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
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;
  const coords = viewAtomCoords(atoms);
  if (!coords?.x || !coords.y || !coords.z) return null;
  return {
    x: coords.x,
    y: coords.y,
    z: coords.z,
    columns: coords.columns,
    n: atoms.nrows(),
  };
}

export function frameBox(frame: Frame): Box | undefined {
  return frame.box;
}
