/**
 * Signed field of a union of balls, deposited by per-atom splatting.
 *
 *   f(p) = maxᵢ (rᵢ − |p − xᵢ|)
 *
 * Positive inside, zero on the surface — the same polarity as the Gaussian
 * density path, so one isovalue of 0 works for every field algorithm.
 *
 * Each ball only writes into its own voxel window, so the cost is
 * `O(N·(r/h)³)` rather than the `O(N·nx·ny·nz)` of a full sweep. Outside every
 * window the field holds {@link BallField.floor}, which is exactly the value a
 * window writes at its own edge — the field stays continuous across the window
 * boundary, so no spurious crossing or NaN normal can appear there.
 */

import type { FieldDomain } from "./grid_domain";

/** Window overshoot past each radius, in voxels. Two gives smooth normals. */
const DEFAULT_MARGIN_VOXELS = 2;

export interface BallFieldInput {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  count: number;
  /** Per-atom radius, Å. Already includes any probe offset. */
  radii: ArrayLike<number>;
}

/** Voxel window of one ball along one axis: unwrapped first and last index. */
function axisWindow(
  centre: number,
  reach: number,
  origin: number,
  step: number,
  n: number,
  periodic: boolean,
): [number, number] {
  const lo = Math.ceil((centre - reach - origin) / step);
  const hi = Math.floor((centre + reach - origin) / step);
  // A periodic window keeps unwrapped indices (folded on write) but never
  // covers more than one period; a ball wider than the cell overlaps itself.
  if (periodic) return [lo, Math.min(hi, lo + n - 1)];
  return [Math.max(0, lo), Math.min(n - 1, hi)];
}

/** Fold an index into [0, n). */
function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** Construct against a domain, then read {@link values}. */
export class BallField {
  readonly values: Float64Array;
  /** Field value outside every ball window; also the window-edge value. */
  readonly floor: number;

  constructor(
    domain: FieldDomain,
    input: BallFieldInput,
    marginVoxels = DEFAULT_MARGIN_VOXELS,
  ) {
    const [hx, hy, hz] = domain.steps;
    const margin = marginVoxels * domain.spacing;
    const { nx, ny, nz, periodic } = domain;
    const [ox, oy, oz] = domain.origin;

    this.floor = -margin;
    const values = new Float64Array(domain.voxelCount).fill(-margin);

    const { x, y, z, count, radii } = input;
    for (let a = 0; a < count; a++) {
      const r = radii[a];
      if (!(r > 0)) continue;
      const reach = r + margin;
      const ax = x[a];
      const ay = y[a];
      const az = z[a];

      const [i0, i1] = axisWindow(ax, reach, ox, hx, nx, periodic);
      if (i0 > i1) continue;
      const [j0, j1] = axisWindow(ay, reach, oy, hy, ny, periodic);
      if (j0 > j1) continue;
      const [k0, k1] = axisWindow(az, reach, oz, hz, nz, periodic);
      if (k0 > k1) continue;

      const reach2 = reach * reach;
      for (let i = i0; i <= i1; i++) {
        const dx = ox + i * hx - ax;
        const dx2 = dx * dx;
        if (dx2 > reach2) continue;
        const row = periodic ? wrap(i, nx) : i;
        for (let j = j0; j <= j1; j++) {
          const dy = oy + j * hy - ay;
          const dxy2 = dx2 + dy * dy;
          if (dxy2 > reach2) continue;
          const base = (row * ny + (periodic ? wrap(j, ny) : j)) * nz;
          for (let k = k0; k <= k1; k++) {
            const dz = oz + k * hz - az;
            const d2 = dxy2 + dz * dz;
            if (d2 > reach2) continue;
            const idx = base + (periodic ? wrap(k, nz) : k);
            const v = r - Math.sqrt(d2);
            if (v > values[idx]) values[idx] = v;
          }
        }
      }
    }

    this.values = values;
  }
}
