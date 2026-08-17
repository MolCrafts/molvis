import type { Box } from "@molcrafts/molvis-core/molrs";

/**
 * Tilt magnitude (Å) at or below which a cell counts as orthorhombic.
 *
 * Shared by the analysis wire (`worker_protocol` omits tilts under this
 * threshold) and every reader that must recover LAMMPS `lx ly lz` from a
 * molrs Box.
 */
export const CELL_TILT_EPS = 1e-9;

/** LAMMPS-style cell: diagonal + tilts + origin + PBC. */
export interface LammpsCell {
  lengths: [number, number, number];
  tilts: [number, number, number];
  origin: [number, number, number];
  pbc: [boolean, boolean, boolean];
}

/**
 * Row-major 3×3 H for molrs `new Box(h, origin, …)` from LAMMPS
 * `lx, ly, lz, xy, xz, yz`. Lattice vectors as columns of H:
 * `a=(lx,0,0)`, `b=(xy,ly,0)`, `c=(xz,yz,lz)`.
 */
export function hMatrixFromLammps(
  lengths: readonly [number, number, number],
  tilts: readonly [number, number, number],
): Float64Array {
  const [lx, ly, lz] = lengths;
  const [xy, xz, yz] = tilts;
  return new Float64Array([lx, xy, xz, 0, ly, yz, 0, 0, lz]);
}

/**
 * Recover LAMMPS `lx ly lz xy xz yz` (+ origin, PBC) from a molrs Box.
 *
 * `Box.lengths()` is the lattice-vector *norms* (`|b| = √(xy² + ly²)`).
 * Pairing those with `Box.tilts()` as if they were the LAMMPS diagonal
 * inflates `ly`/`lz` on any tilted cell. The diagonal lives on
 * `Box.hMatrix()` at flat indices 0 / 4 / 8.
 *
 * The Box handle is borrowed — never freed here. WasmArray wrappers from
 * `origin` / `tilts` / `hMatrix` / `lengths` are.
 */
export function lammpsCellFromBox(box: Box): LammpsCell {
  const originWa = box.origin();
  const tiltsWa = box.tilts();
  try {
    const t = tiltsWa.toCopy();
    const o = originWa.toCopy();
    const tilted = t.some((value) => Math.abs(value) > CELL_TILT_EPS);
    const edges = tilted ? box.hMatrix() : box.lengths();
    try {
      const e = edges.toCopy();
      const p = box.pbc();
      return {
        lengths: tilted ? [e[0], e[4], e[8]] : [e[0], e[1], e[2]],
        tilts: [t[0], t[1], t[2]],
        origin: [o[0], o[1], o[2]],
        pbc: [p[0] === 1, p[1] === 1, p[2] === 1],
      };
    } finally {
      edges.free();
    }
  } finally {
    originWa.free();
    tiltsWa.free();
  }
}
