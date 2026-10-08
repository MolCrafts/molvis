import {
  Block,
  type Frame,
  Frame as FrameClass,
} from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";

/**
 * Build a frame containing only the requested atom rows.
 * The output keeps xyz, element when present, and the source simulation box.
 */
export function buildAtomSubFrame(
  frame: Frame,
  indices: readonly number[],
): Frame | null {
  if (!frame.has("atoms")) return null;
  const atoms = frame.get("atoms");

  const coords = viewAtomCoords(atoms);
  const x = coords?.x;
  const y = coords?.y;
  const z = coords?.z;
  if (!x || !y || !z) return null;

  const n = indices.length;
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const sz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const idx = indices[i];
    sx[i] = x[idx];
    sy[i] = y[idx];
    sz[i] = z[idx];
  }

  const subBlock = new Block();
  subBlock.set("x", sx);
  subBlock.set("y", sy);
  subBlock.set("z", sz);

  // copy throws a raw string when the column is absent (LAMMPS dumps
  // often only have type/id, no element). Probe dtype first.
  if (atoms.has("element")) {
    const elems = atoms.copy("element") as string[];
    if (elems) {
      subBlock.set(
        "element",
        indices.map((idx) => elems[idx]),
      );
    }
  }

  const subFrame = new FrameClass();
  subFrame.set("atoms", subBlock);

  // get_box clones the SimBox; assigning moves that clone into the subframe.
  // Parent frame keeps its own simbox.
  const box = frame.box;
  if (box) subFrame.box = box;

  return subFrame;
}
