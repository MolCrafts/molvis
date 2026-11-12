/**
 * Periodic voxel domain on an orthorhombic simulation cell.
 *
 * The atom-AABB {@link ./grid_domain GridDomain} is right for a molecule in
 * vacuum and wrong for a bulk cell: an amorphous polymer or a framework
 * fills its box, so its surface has to continue through the faces rather
 * than close over the outermost atoms. This domain is the cell itself — nx
 * voxels span exactly one box length, voxel `nx` is voxel `0`, and every
 * kernel folds across the faces. The mesh then lies inside the cell, cut by
 * its faces.
 *
 * Only orthorhombic cells: the ball kernel and the distance transform both
 * assume axis-aligned voxels. A triclinic cell is refused, not approximated.
 *
 * Atoms outside the cell are folded in by the kernel, so the surface sits in
 * the cell even when Particles draw atoms as deposited.
 */

import { type FieldDomain, MAX_VOXELS } from "./grid_domain";

/** An orthorhombic periodic cell: lower corner and edge lengths, Å. */
export interface OrthoCell {
  origin: readonly [number, number, number];
  lengths: readonly [number, number, number];
}

/** Fewer than this many voxels per edge cannot carry a periodic surface. */
const MIN_AXIS = 4;

export class CellDomain implements FieldDomain {
  readonly origin: Float64Array;
  readonly cell: Float64Array;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly steps: readonly [number, number, number];
  readonly spacing: number;
  readonly periodic = true;
  readonly clamped: boolean;

  /**
   * @param cell - The simulation cell.
   * @param spacing - Target voxel spacing, Å. Each axis takes the voxel
   *   count nearest `length / spacing`, so its own step differs from the
   *   target by under half a voxel over the edge; raised isotropically when
   *   the grid would pass {@link MAX_VOXELS}, and {@link clamped} says so.
   */
  constructor(cell: OrthoCell, spacing: number) {
    const [lx, ly, lz] = cell.lengths;
    if (!(lx > 0 && ly > 0 && lz > 0)) {
      throw new Error(
        `cell lengths must be positive, got [${lx}, ${ly}, ${lz}]`,
      );
    }
    const counts = (s: number): [number, number, number] => [
      Math.max(MIN_AXIS, Math.round(lx / s)),
      Math.max(MIN_AXIS, Math.round(ly / s)),
      Math.max(MIN_AXIS, Math.round(lz / s)),
    ];
    let s = Math.max(1e-3, spacing);
    let [nx, ny, nz] = counts(s);
    this.clamped = nx * ny * nz > MAX_VOXELS;
    while (nx * ny * nz > MAX_VOXELS) {
      s *= 1.05;
      [nx, ny, nz] = counts(s);
    }
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.steps = [lx / nx, ly / ny, lz / nz];
    this.spacing = Math.max(...this.steps);
    this.origin = new Float64Array(cell.origin);
    this.cell = new Float64Array([lx, 0, 0, 0, ly, 0, 0, 0, lz]);
  }

  get shape(): [number, number, number] {
    return [this.nx, this.ny, this.nz];
  }

  get voxelCount(): number {
    return this.nx * this.ny * this.nz;
  }

  index(i: number, j: number, k: number): number {
    return (i * this.ny + j) * this.nz + k;
  }
}
