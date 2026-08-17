/**
 * Least-squares rigid-body superposition (the Kabsch algorithm) and RMSD.
 *
 * Pure-function kernel — operates on flat `Float64Array` point sets, has no
 * BabylonJS or WASM dependency, and never mutates its inputs. Callers (e.g. the
 * combine-systems modifier) adapt molrs `Frame` blocks into the flat coordinate
 * layout below before calling in.
 *
 * **Convention** (must be obeyed verbatim — getting it wrong silently transposes
 * the rotation): `P = moving` is rotated and translated onto `Q = reference`.
 * The returned transform superimposes P onto Q via `pₖ ↦ R·pₖ + t`. The
 * cross-covariance is `H = Σ wₖ·q̃ₖ·p̃ₖᵀ` (row index from the reference, column
 * from the moving set); with `H = U·Σ·Vᵀ` the proper-rotation solution is
 * `R = U·diag(1, 1, d)·Vᵀ`, `d = sign(det(U·Vᵀ))`.
 *
 * Coordinates are flat length-`3N` buffers; point k lives at offsets
 * `3k, 3k+1, 3k+2`. Distances/RMSD are in the input length unit (Å in MolVis).
 *
 * References: Kabsch 1976 (Acta Cryst. A32:922–923), Kabsch 1978 (A34:827–828),
 * Coutsias, Seok & Dill 2004 (J Comput Chem 25:1849–1857), Lawrence, Bernal &
 * Witzgall 2019 (J Res NIST 124:124028).
 */

import { svd3 } from "./svd3";

const DIM = 3;

/** Result of {@link superpose}: the rigid transform mapping moving → reference. */
export interface SuperpositionResult {
  /** Optimal proper rotation, row-major 3×3 (length 9), `det(R) = +1`. */
  R: Float64Array;
  /** Optimal translation (length 3): `t = q̄ − R·p̄`. */
  t: Float64Array;
  /** Root-mean-square deviation over the participating points, post-transform. */
  rmsd: number;
}

/** Options for {@link superpose}. */
export interface SuperposeOptions {
  /**
   * Per-point weights indexed by absolute point index (length = point count).
   * Enables mass-weighted centroids, covariance, and RMSD. Omit for unweighted.
   */
  weights?: Float64Array;
  /**
   * Indices of the points that participate in the fit (a 1:1 subset). When
   * given, the moving and reference buffers may differ in length and the fit
   * (and reported RMSD) uses only these points. Omit to pair all points 1:1.
   */
  indices?: Uint32Array;
}

/** Determinant of a row-major 3×3. */
function det3(m: Float64Array): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Multiply two row-major 3×3 matrices: `a·b` (length 9). */
function matmul3(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(9);
  for (let r = 0; r < DIM; r++) {
    for (let c = 0; c < DIM; c++) {
      let sum = 0;
      for (let k = 0; k < DIM; k++) {
        sum += a[DIM * r + k] * b[DIM * k + c];
      }
      out[DIM * r + c] = sum;
    }
  }
  return out;
}

/** Transpose a row-major 3×3 (length 9). */
function transpose3(m: Float64Array): Float64Array {
  const out = new Float64Array(9);
  for (let r = 0; r < DIM; r++) {
    for (let c = 0; c < DIM; c++) {
      out[DIM * c + r] = m[DIM * r + c];
    }
  }
  return out;
}

/** Assert a buffer length is a non-negative multiple of 3 and return the point count. */
function pointCount(buf: Float64Array, label: string): number {
  if (buf.length % DIM !== 0) {
    throw new Error(
      `superpose: ${label} length ${buf.length} is not a multiple of 3`,
    );
  }
  return buf.length / DIM;
}

/**
 * Build a trivial identity correspondence `[0, 1, …, N−1]` for two point sets
 * of equal count. Throws when the counts differ — a 1:1 index map is undefined
 * otherwise, and silently zipping mismatched atoms is never acceptable.
 *
 * @throws if `countMoving !== countReference`.
 */
export function identityCorrespondence(
  countMoving: number,
  countReference: number,
): Uint32Array {
  if (countMoving !== countReference) {
    throw new Error(
      `identityCorrespondence: point count mismatch — moving has ${countMoving}, reference has ${countReference}; provide an explicit index subset to pair a subset`,
    );
  }
  const out = new Uint32Array(countMoving);
  for (let i = 0; i < countMoving; i++) {
    out[i] = i;
  }
  return out;
}

/**
 * Apply a rigid transform `pₖ ↦ R·pₖ + t` to a flat `3N` point buffer.
 * Pure — returns a new buffer.
 *
 * @param points flat length-`3N` coordinates.
 * @param R row-major 3×3 rotation (length 9).
 * @param t translation (length 3).
 */
export function applyTransform(
  points: Float64Array,
  R: Float64Array,
  t: Float64Array,
): Float64Array {
  const n = pointCount(points, "points");
  const out = new Float64Array(points.length);
  for (let k = 0; k < n; k++) {
    const x = points[DIM * k];
    const y = points[DIM * k + 1];
    const z = points[DIM * k + 2];
    out[DIM * k] = R[0] * x + R[1] * y + R[2] * z + t[0];
    out[DIM * k + 1] = R[3] * x + R[4] * y + R[5] * z + t[1];
    out[DIM * k + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
  }
  return out;
}

/**
 * Root-mean-square deviation between two equal-length point sets, measured on
 * the coordinates **as given** (this does NOT superpose first). Optionally
 * mass-weighted.
 *
 * @throws if the buffers differ in length.
 */
export function rmsd(
  moving: Float64Array,
  reference: Float64Array,
  options: { weights?: Float64Array } = {},
): number {
  const n = pointCount(moving, "moving");
  pointCount(reference, "reference");
  if (moving.length !== reference.length) {
    throw new Error(
      `rmsd: point count mismatch — moving has ${moving.length / DIM}, reference has ${reference.length / DIM}`,
    );
  }
  const { weights } = options;
  let sse = 0;
  let totalWeight = 0;
  for (let k = 0; k < n; k++) {
    const w = weights ? weights[k] : 1;
    const dx = moving[DIM * k] - reference[DIM * k];
    const dy = moving[DIM * k + 1] - reference[DIM * k + 1];
    const dz = moving[DIM * k + 2] - reference[DIM * k + 2];
    sse += w * (dx * dx + dy * dy + dz * dz);
    totalWeight += w;
  }
  return Math.sqrt(sse / totalWeight);
}

/**
 * Compute the optimal rigid transform superimposing `moving` (P) onto
 * `reference` (Q) under a fixed 1:1 correspondence, plus the resulting RMSD.
 *
 * Implements Kabsch with the proper-rotation reflection correction: the
 * `d = sign(det(U·Vᵀ))` term forces `det(R) = +1`, so a chirality-flipping
 * mirror solution is never returned even on near-degenerate (collinear /
 * coplanar / `det H ≈ 0`) inputs.
 *
 * @param moving flat length-`3N` coordinates that get rotated + translated.
 * @param reference flat length-`3M` coordinates held fixed.
 * @param options see {@link SuperposeOptions}. Without `indices`, `N` must equal `M`.
 * @returns `{ R, t, rmsd }` — see {@link SuperpositionResult}.
 * @throws if counts mismatch and no `indices` are supplied.
 */
export function superpose(
  moving: Float64Array,
  reference: Float64Array,
  options: SuperposeOptions = {},
): SuperpositionResult {
  const nMoving = pointCount(moving, "moving");
  const nReference = pointCount(reference, "reference");
  const { weights, indices } = options;

  const part = indices ?? identityCorrespondence(nMoving, nReference);
  const count = part.length;

  // Weighted centroids over the participating points.
  let totalWeight = 0;
  const pBar = new Float64Array(DIM);
  const qBar = new Float64Array(DIM);
  for (let i = 0; i < count; i++) {
    const k = part[i];
    const w = weights ? weights[k] : 1;
    totalWeight += w;
    for (let d = 0; d < DIM; d++) {
      pBar[d] += w * moving[DIM * k + d];
      qBar[d] += w * reference[DIM * k + d];
    }
  }
  for (let d = 0; d < DIM; d++) {
    pBar[d] /= totalWeight;
    qBar[d] /= totalWeight;
  }

  // Cross-covariance H = Σ wₖ · q̃ₖ · p̃ₖᵀ  (row r from reference, col c from moving).
  const H = new Float64Array(9);
  for (let i = 0; i < count; i++) {
    const k = part[i];
    const w = weights ? weights[k] : 1;
    const px = moving[DIM * k] - pBar[0];
    const py = moving[DIM * k + 1] - pBar[1];
    const pz = moving[DIM * k + 2] - pBar[2];
    const qx = reference[DIM * k] - qBar[0];
    const qy = reference[DIM * k + 1] - qBar[1];
    const qz = reference[DIM * k + 2] - qBar[2];
    H[0] += w * qx * px;
    H[1] += w * qx * py;
    H[2] += w * qx * pz;
    H[3] += w * qy * px;
    H[4] += w * qy * py;
    H[5] += w * qy * pz;
    H[6] += w * qz * px;
    H[7] += w * qz * py;
    H[8] += w * qz * pz;
  }

  const { U, V } = svd3(H);

  // Proper-rotation correction: flip the smallest singular direction when the
  // raw orthogonal solution would be improper (a reflection).
  const d = det3(U) * det3(V) < 0 ? -1 : 1;
  // U·diag(1, 1, d): scale U's third column by d.
  const Ud = Float64Array.from(U);
  if (d < 0) {
    Ud[2] = -Ud[2];
    Ud[5] = -Ud[5];
    Ud[8] = -Ud[8];
  }
  const R = matmul3(Ud, transpose3(V));

  // t = q̄ − R·p̄.
  const t = new Float64Array(DIM);
  for (let r = 0; r < DIM; r++) {
    t[r] =
      qBar[r] -
      (R[DIM * r] * pBar[0] +
        R[DIM * r + 1] * pBar[1] +
        R[DIM * r + 2] * pBar[2]);
  }

  // RMSD over participating points, post-transform.
  let sse = 0;
  for (let i = 0; i < count; i++) {
    const k = part[i];
    const w = weights ? weights[k] : 1;
    const x = moving[DIM * k];
    const y = moving[DIM * k + 1];
    const z = moving[DIM * k + 2];
    const tx = R[0] * x + R[1] * y + R[2] * z + t[0];
    const ty = R[3] * x + R[4] * y + R[5] * z + t[1];
    const tz = R[6] * x + R[7] * y + R[8] * z + t[2];
    const dx = tx - reference[DIM * k];
    const dy = ty - reference[DIM * k + 1];
    const dz = tz - reference[DIM * k + 2];
    sse += w * (dx * dx + dy * dy + dz * dz);
  }

  return { R, t, rmsd: Math.sqrt(sse / totalWeight) };
}
