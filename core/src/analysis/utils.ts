import type { Frame } from "@molcrafts/molrs";
import { viewAtomCoords } from "../io/atom_coords";

/**
 * Estimate a reasonable rMax cutoff from frame geometry.
 * Periodic: min(box lengths) / 2.  Non-periodic: sampled max distance / 2.
 *
 * @param frame - Frame with atoms block (and optionally box).
 * @returns Estimated rMax in angstrom, or 0 if frame has no usable data.
 */
export function estimateRMax(frame: Frame): number {
  const box = frame.box;
  if (box) {
    const lengths = box.lengths();
    const L = lengths.toCopy();
    lengths.free();
    // Do NOT free box — freeing a box/getBlock handle corrupts the frame's
    // shared data on subsequent reads (see memory: project_molrs_handle_ownership).
    return Math.min(L[0], L[1], L[2]) / 2;
  }

  const atoms = frame.getBlock("atoms");
  if (!atoms) return 0;

  const n = atoms.nrows();
  const coords = viewAtomCoords(atoms);
  const x = coords?.x;
  const y = coords?.y;
  const z = coords?.z;
  if (!x || !y || !z) return 0;

  const step = Math.max(1, Math.floor(n / 100));
  let maxR2 = 0;
  for (let i = 0; i < n; i += step) {
    for (let j = i + 1; j < n; j += step) {
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const dz = z[j] - z[i];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > maxR2) maxR2 = r2;
    }
  }
  return Math.sqrt(maxR2) / 2;
}
