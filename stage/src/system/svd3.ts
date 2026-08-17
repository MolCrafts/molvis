/**
 * Self-contained singular value decomposition of 3×3 matrices.
 *
 * TypeScript has no built-in SVD and we deliberately avoid a dependency, so
 * this module implements a **one-sided Jacobi** SVD specialised to 3×3. The
 * one-sided variant orthogonalises the *columns* of the working matrix via a
 * sequence of right-hand Givens rotations accumulated into `V`; at convergence
 * `A·V = U·Σ`, hence `A = U·Σ·Vᵀ`. This never forms `HᵀH`, so it preserves the
 * precision of the smallest singular value — the direction the Kabsch
 * reflection-correction (`d`-term) acts on (see {@link ./superposition}).
 *
 * All matrices are flat **row-major** `Float64Array`s of length 9 (`m[3*r + c]`)
 * and all vectors are length 3. The function is pure: it copies its input and
 * never mutates it.
 */

const DIM = 3;
/** Relative threshold for "converged" / "singular value is zero". */
const EPS = 1e-15;
/** Cap on Jacobi sweeps; a 3×3 converges to machine precision in well under this. */
const MAX_SWEEPS = 60;

/** Result of {@link svd3}: `H ≈ U·diag(S)·Vᵀ` with `U`, `V` orthonormal. */
export interface Svd3Result {
  /** Left singular vectors as columns, row-major 3×3 (length 9). */
  U: Float64Array;
  /** Singular values, sorted descending, all ≥ 0 (length 3). */
  S: Float64Array;
  /** Right singular vectors as columns, row-major 3×3 (length 9). */
  V: Float64Array;
}

/** Row-major 3×3 identity (fresh copy each call). */
function identity3(): Float64Array {
  return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

/** Reorder the columns of a row-major 3×3 so output column k = input column `order[k]`. */
function reorderColumns(
  m: Float64Array,
  order: readonly number[],
): Float64Array {
  const out = new Float64Array(9);
  for (let k = 0; k < DIM; k++) {
    const src = order[k];
    for (let i = 0; i < DIM; i++) {
      out[DIM * i + k] = m[DIM * i + src];
    }
  }
  return out;
}

/** Euclidean norm of column `j` of a row-major 3×3. */
function columnNorm(m: Float64Array, j: number): number {
  let sum = 0;
  for (let i = 0; i < DIM; i++) {
    const v = m[DIM * i + j];
    sum += v * v;
  }
  return Math.sqrt(sum);
}

/** Write `vec` (length 3) into column `j` of the row-major 3×3 `m`. */
function setColumn(
  m: Float64Array,
  j: number,
  vec: readonly [number, number, number],
): void {
  m[DIM * 0 + j] = vec[0];
  m[DIM * 1 + j] = vec[1];
  m[DIM * 2 + j] = vec[2];
}

/** Read column `j` of a row-major 3×3 as a length-3 tuple. */
function getColumn(m: Float64Array, j: number): [number, number, number] {
  return [m[DIM * 0 + j], m[DIM * 1 + j], m[DIM * 2 + j]];
}

/** Cross product of two length-3 tuples. */
function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Normalise a length-3 tuple; returns it unchanged-direction with unit length. */
function normalize(
  v: readonly [number, number, number],
): [number, number, number] {
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Fill any zero/degenerate columns of `U` (those whose singular value is ~0)
 * with unit vectors orthogonal to the good columns, so `U` stays orthonormal.
 * Columns are pre-sorted descending, so the degenerate ones are the trailing
 * `g..2`. Mutates `U` in place (it is a fresh local array).
 */
function completeOrthonormalU(U: Float64Array, S: Float64Array): void {
  const tol = EPS * (S[0] > 0 ? S[0] : 1);
  let good = 0;
  while (good < DIM && S[good] > tol) {
    good++;
  }

  if (good === DIM) {
    return;
  }
  if (good === 0) {
    // Whole matrix was ~0: any orthonormal basis works — use the identity.
    U.set(identity3());
    return;
  }
  if (good === 2) {
    setColumn(U, 2, normalize(cross(getColumn(U, 0), getColumn(U, 1))));
    return;
  }
  // good === 1: build two orthonormal vectors spanning the plane ⊥ column 0.
  const u0 = getColumn(U, 0);
  // Pick a helper axis least parallel to u0.
  const helper: [number, number, number] =
    Math.abs(u0[0]) <= Math.abs(u0[1]) && Math.abs(u0[0]) <= Math.abs(u0[2])
      ? [1, 0, 0]
      : Math.abs(u0[1]) <= Math.abs(u0[2])
        ? [0, 1, 0]
        : [0, 0, 1];
  const dot = helper[0] * u0[0] + helper[1] * u0[1] + helper[2] * u0[2];
  const u1 = normalize([
    helper[0] - dot * u0[0],
    helper[1] - dot * u0[1],
    helper[2] - dot * u0[2],
  ]);
  setColumn(U, 1, u1);
  setColumn(U, 2, cross(u0, u1));
}

/**
 * Compute the SVD of a 3×3 matrix `H` (row-major, length 9) such that
 * `H = U·diag(S)·Vᵀ` with `U`, `V` orthonormal and `S` sorted descending,
 * all `S[i] ≥ 0`.
 *
 * @param H row-major 3×3 matrix (length 9).
 * @returns `{ U, S, V }` — see {@link Svd3Result}.
 * @throws if `H` is not length 9.
 */
export function svd3(H: Float64Array): Svd3Result {
  if (H.length !== 9) {
    throw new Error(
      `svd3: expected a length-9 row-major 3x3 matrix, received length ${H.length}`,
    );
  }

  // Working copy whose columns get orthogonalised in place; V accumulates the rotations.
  const A = Float64Array.from(H);
  const V = identity3();

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let off = 0;
    for (let p = 0; p < DIM; p++) {
      for (let q = p + 1; q < DIM; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < DIM; i++) {
          const aip = A[DIM * i + p];
          const aiq = A[DIM * i + q];
          alpha += aip * aip;
          beta += aiq * aiq;
          gamma += aip * aiq;
        }
        off += Math.abs(gamma);
        if (gamma === 0 || Math.abs(gamma) <= EPS * Math.sqrt(alpha * beta)) {
          continue;
        }
        // Jacobi rotation (c, s) that zeros the ⟨col p, col q⟩ inner product.
        const zeta = (beta - alpha) / (2 * gamma);
        const tan =
          zeta === 0
            ? 1
            : Math.sign(zeta) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + tan * tan);
        const s = c * tan;
        // Rotation that zeros ⟨col p, col q⟩, consistent with ζ = (β−α)/(2γ):
        //   col p' = c·col p − s·col q ;  col q' = s·col p + c·col q
        for (let i = 0; i < DIM; i++) {
          const aip = A[DIM * i + p];
          const aiq = A[DIM * i + q];
          A[DIM * i + p] = c * aip - s * aiq;
          A[DIM * i + q] = s * aip + c * aiq;
          const vip = V[DIM * i + p];
          const viq = V[DIM * i + q];
          V[DIM * i + p] = c * vip - s * viq;
          V[DIM * i + q] = s * vip + c * viq;
        }
      }
    }
    if (off <= EPS) {
      break;
    }
  }

  // Column norms are the singular values; normalised columns are U.
  const sigma = new Float64Array(DIM);
  const U = new Float64Array(9);
  for (let j = 0; j < DIM; j++) {
    const norm = columnNorm(A, j);
    sigma[j] = norm;
    if (norm > EPS) {
      for (let i = 0; i < DIM; i++) {
        U[DIM * i + j] = A[DIM * i + j] / norm;
      }
    }
  }

  // Sort descending, carrying U and V columns along.
  const order = [0, 1, 2].sort((a, b) => sigma[b] - sigma[a]);
  const Us = reorderColumns(U, order);
  const Vs = reorderColumns(V, order);
  const Ss = new Float64Array([
    sigma[order[0]],
    sigma[order[1]],
    sigma[order[2]],
  ]);

  completeOrthonormalU(Us, Ss);

  return { U: Us, S: Ss, V: Vs };
}
