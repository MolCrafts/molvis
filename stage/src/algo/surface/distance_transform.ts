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
   * @param spacing - Isotropic voxel spacing, Å.
   * @param seeds - Row-major (ix outermost); a non-zero entry is a seed.
   */
  constructor(
    shape: [number, number, number],
    spacing: number,
    seeds: Uint8Array,
  ) {
    const [nx, ny, nz] = shape;
    // Squared distance in voxel units; scaled to Å once at the end.
    const sq = new Float64Array(nx * ny * nz);
    for (let i = 0; i < sq.length; i++) sq[i] = seeds[i] !== 0 ? 0 : FAR;

    const maxAxis = Math.max(nx, ny, nz);
    const scratch = new Scratch(maxAxis);

    // Along z: contiguous runs, stride 1.
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        scratch.transform(sq, (i * ny + j) * nz, 1, nz);
      }
    }
    // Along y: stride nz.
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        scratch.transform(sq, i * ny * nz + k, nz, ny);
      }
    }
    // Along x: stride ny*nz.
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        scratch.transform(sq, j * nz + k, ny * nz, nx);
      }
    }

    const distances = new Float64Array(sq.length);
    for (let i = 0; i < sq.length; i++)
      distances[i] = Math.sqrt(sq[i]) * spacing;
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

  constructor(maxAxis: number) {
    this.f = new Float64Array(maxAxis);
    this.d = new Float64Array(maxAxis);
    this.v = new Int32Array(maxAxis);
    this.z = new Float64Array(maxAxis + 1);
  }

  /** In-place 1-D squared-distance transform over one strided scanline. */
  transform(
    data: Float64Array,
    offset: number,
    stride: number,
    n: number,
  ): void {
    const f = this.f;
    const d = this.d;
    const v = this.v;
    const z = this.z;
    for (let q = 0; q < n; q++) f[q] = data[offset + q * stride];

    let k = 0;
    v[0] = 0;
    z[0] = -FAR;
    z[1] = FAR;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = FAR;
    }

    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
    for (let q = 0; q < n; q++) data[offset + q * stride] = d[q];
  }
}
