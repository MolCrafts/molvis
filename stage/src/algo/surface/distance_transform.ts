/**
 * Exact Euclidean distance transform on a uniform 3-D grid.
 *
 * Felzenszwalb–Huttenlocher lower-envelope-of-parabolas, run separably along
 * z, then y, then x — `O(nx·ny·nz)` total, and exact rather than the
 * chamfer approximation.
 *
 * `distances[idx]` is the world-space distance (Å) from voxel `idx` to the
 * nearest seed voxel. Seeds themselves are 0.
 *
 * Spacing may differ per axis (a periodic cell divides each edge into a
 * whole number of voxels), and a periodic grid measures to the nearest seed
 * image: each scanline is run over three copies of itself and the middle
 * copy kept, which is exact as long as the nearest seed is within one
 * period — always true on a periodic grid with any seed at all.
 *
 * Kept independent of {@link ./grid_domain} so it can be tested against a
 * brute-force reference on a hand-built mask.
 */

/** Stands in for +∞ while staying inside finite arithmetic. */
const FAR = 1e20;

/** Construct against a mask, then read {@link distances}. */
export class EuclideanDistanceTransform {
  readonly distances: Float64Array;

  /**
   * @param shape - Grid dimensions [nx, ny, nz].
   * @param spacing - Voxel spacing, Å: one value, or one per axis.
   * @param seeds - Row-major (ix outermost); a non-zero entry is a seed.
   * @param periodic - Wrap every axis.
   */
  constructor(
    shape: [number, number, number],
    spacing: number | readonly [number, number, number],
    seeds: Uint8Array,
    periodic = false,
  ) {
    const [nx, ny, nz] = shape;
    const [hx, hy, hz] =
      typeof spacing === "number" ? [spacing, spacing, spacing] : spacing;
    // Squared world distance, Å².
    const sq = new Float64Array(nx * ny * nz);
    for (let i = 0; i < sq.length; i++) sq[i] = seeds[i] !== 0 ? 0 : FAR;

    const maxAxis = Math.max(nx, ny, nz);
    const scratch = new Scratch(periodic ? 3 * maxAxis : maxAxis, periodic);

    // Along z: contiguous runs, stride 1.
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        scratch.transform(sq, (i * ny + j) * nz, 1, nz, hz * hz);
      }
    }
    // Along y: stride nz.
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        scratch.transform(sq, i * ny * nz + k, nz, ny, hy * hy);
      }
    }
    // Along x: stride ny*nz.
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        scratch.transform(sq, j * nz + k, ny * nz, nx, hx * hx);
      }
    }

    const distances = new Float64Array(sq.length);
    for (let i = 0; i < sq.length; i++) distances[i] = Math.sqrt(sq[i]);
    this.distances = distances;
  }
}

/**
 * Reusable buffers for the 1-D pass, so a 4M-voxel grid does not allocate
 * three arrays per scanline.
 */
class Scratch {
  private readonly f: Float64Array;
  private readonly d: Float64Array;
  /** Locations of the parabolas in the lower envelope. */
  private readonly v: Int32Array;
  /** Boundaries between neighbouring parabolas. */
  private readonly z: Float64Array;

  constructor(
    maxLength: number,
    private readonly periodic: boolean,
  ) {
    this.f = new Float64Array(maxLength);
    this.d = new Float64Array(maxLength);
    this.v = new Int32Array(maxLength);
    this.z = new Float64Array(maxLength + 1);
  }

  /**
   * In-place 1-D squared-distance transform over one strided scanline.
   * `h2` is the squared spacing along it; values are Å².
   */
  transform(
    data: Float64Array,
    offset: number,
    stride: number,
    n: number,
    h2: number,
  ): void {
    const f = this.f;
    const d = this.d;
    const v = this.v;
    const z = this.z;
    const copies = this.periodic ? 3 : 1;
    const m = copies * n;
    for (let q = 0; q < m; q++) f[q] = data[offset + (q % n) * stride];

    // Parabola p is h2·(q − p)² + f[p]; intersections in index units.
    let k = 0;
    v[0] = 0;
    z[0] = -FAR;
    z[1] = FAR;
    for (let q = 1; q < m; q++) {
      let s =
        (f[q] + h2 * q * q - (f[v[k]] + h2 * v[k] * v[k])) /
        (2 * h2 * (q - v[k]));
      while (s <= z[k]) {
        k--;
        s =
          (f[q] + h2 * q * q - (f[v[k]] + h2 * v[k] * v[k])) /
          (2 * h2 * (q - v[k]));
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = FAR;
    }

    k = 0;
    for (let q = 0; q < m; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = h2 * dq * dq + f[v[k]];
    }
    const first = this.periodic ? n : 0;
    for (let q = 0; q < n; q++) data[offset + q * stride] = d[first + q];
  }
}
