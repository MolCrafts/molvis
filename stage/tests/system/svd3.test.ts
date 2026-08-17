/**
 * SVD of 3×3 matrices — pure-math kernel tests.
 *
 * Implementation: `core/src/system/svd3.ts`
 *
 *   svd3(H: Float64Array /* length 9, row-major m[3*r+c] *\/):
 *     { U: Float64Array /* 9 *\/, S: Float64Array /* 3 *\/, V: Float64Array /* 9 *\/ }
 *
 * Acceptance: ac-001 (type: scientific).
 *
 * No BabylonJS / WASM dependency — runs purely in the rstest environment.
 * Reconstruction (U·diag(S)·Vᵀ ≈ H) and orthonormality (UᵀU ≈ I, VᵀV ≈ I)
 * are self-checking properties, so no U/V reference values are hardcoded.
 */

import { describe, expect, test } from "@rstest/core";
import { svd3 } from "../../src/system/svd3";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Multiply two 3×3 row-major matrices: returns a·b (length 9). */
function matmul3(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += a[3 * r + k] * b[3 * k + c];
      }
      out[3 * r + c] = sum;
    }
  }
  return out;
}

/** Transpose a 3×3 row-major matrix (length 9). */
function transpose3(m: Float64Array): Float64Array {
  const out = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[3 * c + r] = m[3 * r + c];
    }
  }
  return out;
}

/** Build a row-major diagonal 3×3 matrix from a length-3 vector. */
function diag3(s: Float64Array): Float64Array {
  const out = new Float64Array(9);
  out[0] = s[0];
  out[4] = s[1];
  out[8] = s[2];
  return out;
}

const IDENTITY3 = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Element-wise closeness of two 3×3 matrices within tol. */
function matsClose(a: Float64Array, b: Float64Array, tol: number): boolean {
  if (a.length !== 9 || b.length !== 9) {
    return false;
  }
  for (let i = 0; i < 9; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      return false;
    }
    if (Math.abs(a[i] - b[i]) > tol) {
      return false;
    }
  }
  return true;
}

/** Reconstruct U·diag(S)·Vᵀ from an svd3 result. */
function reconstruct(res: {
  U: Float64Array;
  S: Float64Array;
  V: Float64Array;
}): Float64Array {
  return matmul3(matmul3(res.U, diag3(res.S)), transpose3(res.V));
}

// Position is the relevant scientific quantity here (matrix entries are
// coordinate-scale); exact-match tolerance column = 1e-12, but reconstruction
// accumulates a few float ops so the spec pins this at 1e-9.
const TOL = 1e-9;

// ── Fixtures: a spread of conditioning regimes ──────────────────────────────────

const FIXTURES: ReadonlyArray<{ name: string; H: Float64Array }> = [
  {
    name: "generic well-conditioned",
    H: new Float64Array([2, -1, 0, 1, 3, 1, 0, -2, 4]),
  },
  {
    name: "symmetric",
    H: new Float64Array([2, 1, 0, 1, 3, -1, 0, -1, 4]),
  },
  {
    name: "diagonal",
    H: new Float64Array([5, 0, 0, 0, 2, 0, 0, 0, 1]),
  },
  {
    // rank-1: outer product u·vᵀ, u = (1,2,3), v = (1,1,1)
    name: "rank-deficient (rank-1)",
    H: new Float64Array([1, 1, 1, 2, 2, 2, 3, 3, 3]),
  },
];

// ── Tests ───────────────────────────────────────────────────────────────────

describe("svd3 (ac-001)", () => {
  for (const { name, H } of FIXTURES) {
    test(`ac-001 reconstruction: U·diag(S)·Vᵀ ≈ H for ${name}`, () => {
      const res = svd3(H);
      expect(res.U.length).toBe(9);
      expect(res.S.length).toBe(3);
      expect(res.V.length).toBe(9);
      const rebuilt = reconstruct(res);
      expect(matsClose(rebuilt, H, TOL)).toBe(true);
    });

    test(`ac-001 orthonormality: UᵀU ≈ I and VᵀV ≈ I for ${name}`, () => {
      const res = svd3(H);
      expect(matsClose(matmul3(transpose3(res.U), res.U), IDENTITY3, TOL)).toBe(
        true,
      );
      expect(matsClose(matmul3(transpose3(res.V), res.V), IDENTITY3, TOL)).toBe(
        true,
      );
    });

    test(`ac-001 ordering: S[0] >= S[1] >= S[2] >= 0 for ${name}`, () => {
      const res = svd3(H);
      expect(res.S[0]).toBeGreaterThanOrEqual(res.S[1] - TOL);
      expect(res.S[1]).toBeGreaterThanOrEqual(res.S[2] - TOL);
      expect(res.S[2]).toBeGreaterThanOrEqual(-TOL);
    });
  }
});
