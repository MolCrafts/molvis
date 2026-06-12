import type { Vec3 } from "./pose";

/**
 * An oriented bounding box of a (radius-expanded) point cloud.
 *
 * `axes` are orthonormal principal directions ordered by descending spread
 * (`axes[0]` = major, `axes[2]` = minor); `halfExtents[k]` is the half-width
 * along `axes[k]`, **including** each point's radius. `center` is the geometric
 * center of the box (midpoint of the projected extents), not the centroid.
 *
 * `degenerate` is set when the principal directions are ill-defined (fewer than
 * three points, collinear/coplanar clouds, or near-equal eigenvalues). In that
 * case `axes` fall back to the world axes so callers get a stable, finite,
 * NaN-free box and can choose a deterministic view instead of a noisy one.
 */
export interface Obb {
  center: Vec3;
  axes: readonly [Vec3, Vec3, Vec3];
  halfExtents: Vec3;
  degenerate: boolean;
}

/** Relative eigenvalue gap below which principal directions are treated as degenerate. */
const DEGENERACY_REL_EPS = 1e-6;

const WORLD_AXES: readonly [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * Symmetric 3×3 eigendecomposition via cyclic Jacobi rotations.
 *
 * Robust and NaN-free for any real symmetric input (the molecular covariance
 * matrix). Returns eigenvalues sorted descending with their orthonormal
 * eigenvectors (as column vectors). Converges in a handful of sweeps for 3×3.
 *
 * @param m Row-major symmetric 3×3 matrix (`m[i][j] === m[j][i]`).
 * @returns `values` (descending) and `vectors` (aligned to `values`).
 */
export function symEig3x3(m: readonly number[][]): {
  values: [number, number, number];
  vectors: [Vec3, Vec3, Vec3];
} {
  // Work on mutable copies.
  const a = [
    [m[0][0], m[0][1], m[0][2]],
    [m[1][0], m[1][1], m[1][2]],
    [m[2][0], m[2][1], m[2][2]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-18) break;

    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const apq = a[p][q];
      if (Math.abs(apq) < 1e-300) continue;
      const app = a[p][p];
      const aqq = a[q][q];
      const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
      const c = Math.cos(phi);
      const s = Math.sin(phi);

      // Rotate A: A' = Jᵀ A J
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      // Accumulate eigenvectors.
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }

  const eigs: { value: number; vector: Vec3 }[] = [0, 1, 2].map((j) => ({
    value: a[j][j],
    vector: [v[0][j], v[1][j], v[2][j]] as Vec3,
  }));
  eigs.sort((x, y) => y.value - x.value);

  return {
    values: [eigs[0].value, eigs[1].value, eigs[2].value],
    vectors: [eigs[0].vector, eigs[1].vector, eigs[2].vector],
  };
}

/**
 * Symmetric covariance matrix (row-major 3×3) of a point cloud about its
 * centroid. Direction-only: radii are folded into extents, not the covariance,
 * so the axes describe the cloud's *shape* and not its atom sizes.
 */
export function covariance3x3(
  points: Float64Array,
  centroid: Vec3,
): number[][] {
  const n = points.length / 3;
  let cxx = 0;
  let cxy = 0;
  let cxz = 0;
  let cyy = 0;
  let cyz = 0;
  let czz = 0;
  for (let i = 0; i < n; i++) {
    const dx = points[i * 3] - centroid[0];
    const dy = points[i * 3 + 1] - centroid[1];
    const dz = points[i * 3 + 2] - centroid[2];
    cxx += dx * dx;
    cxy += dx * dy;
    cxz += dx * dz;
    cyy += dy * dy;
    cyz += dy * dz;
    czz += dz * dz;
  }
  const inv = n > 0 ? 1 / n : 0;
  return [
    [cxx * inv, cxy * inv, cxz * inv],
    [cxy * inv, cyy * inv, cyz * inv],
    [cxz * inv, cyz * inv, czz * inv],
  ];
}

/**
 * Compute the {@link Obb} of a radius-expanded point cloud.
 *
 * Axes come from the PCA (principal axes) of the point positions; extents are
 * the min/max projections of `point ± radius` onto each axis, so every sphere
 * is fully enclosed. Degenerate clouds (n < 3, collinear/coplanar, or
 * near-equal spreads) fall back to world axes with `degenerate: true`.
 *
 * @param points Flat `[x,y,z, x,y,z, …]` coordinates, in Å.
 * @param radii  Per-point radii (Å), or `null` to treat all radii as zero.
 */
export function computeObb(
  points: Float64Array,
  radii: Float64Array | null,
): Obb {
  const n = points.length / 3;
  if (n === 0) {
    return {
      center: [0, 0, 0],
      axes: WORLD_AXES,
      halfExtents: [0, 0, 0],
      degenerate: true,
    };
  }

  // Unweighted centroid.
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < n; i++) {
    mx += points[i * 3];
    my += points[i * 3 + 1];
    mz += points[i * 3 + 2];
  }
  const centroid: Vec3 = [mx / n, my / n, mz / n];

  const cov = covariance3x3(points, centroid);
  const { values, vectors } = symEig3x3(cov);

  // Degenerate when the cloud is effectively lower-dimensional or isotropic:
  // the minor axis (vs the middle axis) is then ill-defined.
  const scale = Math.max(values[0], DEGENERACY_REL_EPS);
  const degenerate =
    n < 3 || values[1] - values[2] < DEGENERACY_REL_EPS * scale;
  const axes: readonly [Vec3, Vec3, Vec3] = degenerate ? WORLD_AXES : vectors;

  // Project (point ± radius) onto each axis to get extents and the box center.
  const center: [number, number, number] = [
    centroid[0],
    centroid[1],
    centroid[2],
  ];
  const halfExtents: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const axis = axes[k];
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const t =
        (points[i * 3] - centroid[0]) * axis[0] +
        (points[i * 3 + 1] - centroid[1]) * axis[1] +
        (points[i * 3 + 2] - centroid[2]) * axis[2];
      const r = radii ? radii[i] : 0;
      if (t - r < lo) lo = t - r;
      if (t + r > hi) hi = t + r;
    }
    const mid = (lo + hi) * 0.5;
    halfExtents[k] = (hi - lo) * 0.5;
    center[0] += mid * axis[0];
    center[1] += mid * axis[1];
    center[2] += mid * axis[2];
  }

  return {
    center,
    axes,
    halfExtents,
    degenerate,
  };
}
