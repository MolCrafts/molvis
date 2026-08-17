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
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;

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
  subBlock.setColF("x", sx);
  subBlock.setColF("y", sy);
  subBlock.setColF("z", sz);

  // copyColStr throws a raw string when the column is absent (LAMMPS dumps
  // often only have type/id, no element). Probe dtype first.
  if (atoms.dtype("element") !== undefined) {
    const elems = atoms.copyColStr("element");
    if (elems) {
      subBlock.setColStr(
        "element",
        indices.map((idx) => elems[idx]),
      );
    }
  }

  const subFrame = new FrameClass();
  subFrame.insertBlock("atoms", subBlock);

  // get_box clones the SimBox; assigning moves that clone into the subframe.
  // Parent frame keeps its own simbox.
  const box = frame.box;
  if (box) subFrame.box = box;

  return subFrame;
}
