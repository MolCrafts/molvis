/**
 * Kabsch superposition kernel — pure-math tests.
 *
 * Implementation: `core/src/system/superposition.ts`
 *
 *   type SuperpositionResult = { R: Float64Array /* 9 row-major *\/, t: Float64Array /* 3 *\/, rmsd: number }
 *   superpose(moving, reference, options?: { weights?, indices? }): SuperpositionResult
 *   rmsd(moving, reference, options?: { weights? }): number
 *   applyTransform(points, R, t): Float64Array
 *   identityCorrespondence(countMoving, countReference): Uint32Array
 *
 * CONVENTION (asserted below): P = moving is rotated+translated onto
 * Q = reference. The result superimposes P onto Q via  pₖ ↦ R·pₖ + t.
 * Point k coordinates live at offsets 3k, 3k+1, 3k+2.
 *
 * Acceptance criteria: ac-002 … ac-011.
 *
 * No BabylonJS / WASM dependency — runs purely in the rstest environment.
 * All fixtures are fixed literals (no Math.random) so every run is identical.
 */

import { describe, expect, test } from "@rstest/core";
import {
  applyTransform,
  identityCorrespondence,
  rmsd,
  superpose,
} from "../../src/system/superposition";

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

/** Row-major rotation about +z by theta radians. */
function rotZ(theta: number): Float64Array {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return new Float64Array([c, -s, 0, s, c, 0, 0, 0, 1]);
}

/** Row-major rotation about +x by theta radians. */
function rotX(theta: number): Float64Array {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return new Float64Array([1, 0, 0, 0, c, -s, 0, s, c]);
}

/** Determinant of a 3×3 row-major matrix. */
function det3(m: Float64Array): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/**
 * Apply (R·p + t) to a flat 3N point buffer. Independent reference
 * implementation used to build fixtures (not the symbol under test).
 */
function applyRot(
  points: Float64Array,
  R: Float64Array,
  t: Float64Array,
): Float64Array {
  const n = points.length / 3;
  const out = new Float64Array(points.length);
  for (let k = 0; k < n; k++) {
    const x = points[3 * k];
    const y = points[3 * k + 1];
    const z = points[3 * k + 2];
    out[3 * k] = R[0] * x + R[1] * y + R[2] * z + t[0];
    out[3 * k + 1] = R[3] * x + R[4] * y + R[5] * z + t[1];
    out[3 * k + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
  }
  return out;
}

const IDENTITY3 = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const ZERO3 = new Float64Array([0, 0, 0]);

function matsClose(a: Float64Array, b: Float64Array, tol: number): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      return false;
    }
    if (Math.abs(a[i] - b[i]) > tol) {
      return false;
    }
  }
  return true;
}

function vecsClose(a: Float64Array, b: Float64Array, tol: number): boolean {
  return matsClose(a, b, tol);
}

function allFinite(values: Float64Array | number[]): boolean {
  for (const v of values) {
    if (!Number.isFinite(v)) {
      return false;
    }
  }
  return true;
}

// Position-scale quantities → exact-match tolerance column = 1e-12; the spec
// pins kernel comparisons at 1e-9 to absorb accumulated float ops.
const TOL = 1e-9;

/** Non-coplanar reference cloud (a unit tetrahedron, offset off-origin). */
const TETRA = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]);

// ── ac-002 identity ─────────────────────────────────────────────────────────

describe("superpose (ac-002 identity)", () => {
  test("ac-002 superpose(P, P) ⇒ R≈I, t≈0, rmsd≈0", () => {
    const P = TETRA.slice();
    const res = superpose(P, P.slice());
    expect(matsClose(res.R, IDENTITY3, TOL)).toBe(true);
    expect(vecsClose(res.t, ZERO3, TOL)).toBe(true);
    expect(Math.abs(res.rmsd)).toBeLessThan(TOL);
  });
});

// ── ac-003 pure translation ────────────────────────────────────────────────

describe("superpose (ac-003 translation)", () => {
  test("ac-003 Q = P + c ⇒ R≈I, t≈c, rmsd≈0", () => {
    const c = new Float64Array([3, -2, 5]);
    const P = TETRA.slice();
    const Q = applyRot(P, IDENTITY3, c);
    const res = superpose(P, Q);
    expect(matsClose(res.R, IDENTITY3, TOL)).toBe(true);
    expect(vecsClose(res.t, c, TOL)).toBe(true);
    expect(Math.abs(res.rmsd)).toBeLessThan(TOL);
  });
});

// ── ac-004 known rotation ────────────────────────────────────────────────────

describe("superpose (ac-004 known rotation)", () => {
  test("ac-004 90° about z: recovered R ≈ applied R, rmsd≈0, applyTransform(P) ≈ Q", () => {
    const R = rotZ(Math.PI / 2);
    const P = TETRA.slice();
    const Q = applyRot(P, R, ZERO3);
    const res = superpose(P, Q);
    expect(matsClose(res.R, R, TOL)).toBe(true);
    expect(Math.abs(res.rmsd)).toBeLessThan(TOL);
    const mapped = applyTransform(P, res.R, res.t);
    expect(matsClose(mapped, Q, TOL)).toBe(true);
  });

  test("ac-004 arbitrary rotation (Rz·Rx) with translation: recovered R ≈ applied R", () => {
    const R = matmul3(rotZ(0.7), rotX(-1.2));
    const t = new Float64Array([1, 2, -3]);
    const P = TETRA.slice();
    const Q = applyRot(P, R, t);
    const res = superpose(P, Q);
    expect(matsClose(res.R, R, TOL)).toBe(true);
    expect(Math.abs(res.rmsd)).toBeLessThan(TOL);
    const mapped = applyTransform(P, res.R, res.t);
    expect(matsClose(mapped, Q, TOL)).toBe(true);
  });
});

// ── ac-005 reflection / det-sign guard ───────────────────────────────────────

describe("superpose (ac-005 reflection / proper-rotation guard)", () => {
  test("ac-005 naive solution would be a reflection ⇒ Kabsch returns det(R) ≈ +1", () => {
    // Q is a mirrored copy of P (z negated) plus tiny noise. A naive SVD
    // solution would yield an improper rotation (det ≈ -1); the d-term
    // correction must instead return the closest PROPER rotation.
    const P = TETRA.slice();
    const mirror = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, -1]);
    const Q = applyRot(P, mirror, ZERO3);
    // small deterministic perturbation so it is not an exact reflection
    Q[2] += 0.01;
    Q[5] -= 0.01;
    const res = superpose(P, Q);
    expect(det3(res.R)).toBeCloseTo(1, 6);
    expect(det3(res.R)).toBeGreaterThan(0);
    // mirror solution explicitly NOT returned
    expect(matsClose(res.R, mirror, 1e-2)).toBe(false);
  });
});

// ── ac-006 small N ────────────────────────────────────────────────────────────

describe("superpose (ac-006 N=1 and N=2)", () => {
  test("ac-006 N=1 ⇒ R≈I, t≈ q0−p0, rmsd≈0", () => {
    const P = new Float64Array([1, 2, 3]);
    const Q = new Float64Array([4, 6, 8]);
    const res = superpose(P, Q);
    expect(matsClose(res.R, IDENTITY3, TOL)).toBe(true);
    expect(vecsClose(res.t, new Float64Array([3, 4, 5]), TOL)).toBe(true);
    expect(Math.abs(res.rmsd)).toBeLessThan(TOL);
  });

  test("ac-006 N=2 ⇒ finite R/t/rmsd, det(R)≈+1, deterministic across calls", () => {
    const P = new Float64Array([0, 0, 0, 1, 0, 0]);
    const Q = new Float64Array([0, 0, 0, 0, 1, 0]);
    const res1 = superpose(P, Q);
    expect(allFinite(res1.R)).toBe(true);
    expect(allFinite(res1.t)).toBe(true);
    expect(Number.isFinite(res1.rmsd)).toBe(true);
    expect(det3(res1.R)).toBeCloseTo(1, 6);
    const res2 = superpose(P.slice(), Q.slice());
    expect(matsClose(res1.R, res2.R, TOL)).toBe(true);
    expect(vecsClose(res1.t, res2.t, TOL)).toBe(true);
    expect(res1.rmsd).toBe(res2.rmsd);
  });
});

// ── ac-007 degenerate geometry ────────────────────────────────────────────────

describe("superpose (ac-007 collinear and coplanar)", () => {
  test("ac-007 collinear P/Q ⇒ finite R (det≈+1) and finite rmsd, no NaN/Inf", () => {
    const P = new Float64Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
    const Q = applyRot(P, rotZ(Math.PI / 3), new Float64Array([1, 1, 0]));
    const res = superpose(P, Q);
    expect(allFinite(res.R)).toBe(true);
    expect(allFinite(res.t)).toBe(true);
    expect(Number.isFinite(res.rmsd)).toBe(true);
    expect(det3(res.R)).toBeCloseTo(1, 6);
  });

  test("ac-007 coplanar P/Q ⇒ finite R (det≈+1) and finite rmsd, no NaN/Inf", () => {
    const P = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    const Q = applyRot(P, rotX(0.9), new Float64Array([0, 2, -1]));
    const res = superpose(P, Q);
    expect(allFinite(res.R)).toBe(true);
    expect(allFinite(res.t)).toBe(true);
    expect(Number.isFinite(res.rmsd)).toBe(true);
    expect(det3(res.R)).toBeCloseTo(1, 6);
  });
});

// ── ac-008 mass-weighted vs unweighted ────────────────────────────────────────

describe("superpose (ac-008 weighted RMSD)", () => {
  test("ac-008 non-uniform weights change rmsd, matching a hand-derived value", () => {
    // Hand fixture: two points, already at origin-symmetric positions on x.
    //   P = [ (-1,0,0), (1,0,0) ]   Q = [ (-1,0,0), (3,0,0) ]
    // Both clouds are collinear on x, so the optimal rotation is I and the
    // problem reduces to a 1-D weighted alignment of the x offsets.
    //
    // Weights w = [3, 1] (sum W = 4).
    //   weighted centroid of P: x̄P = (3·-1 + 1·1)/4 = -0.5
    //   weighted centroid of Q: x̄Q = (3·-1 + 1·3)/4 =  0.0
    //   centered P: [-0.5, 1.5]   centered Q: [-1.0, 3.0]
    //   residuals after R=I, optimal t removes centroids:
    //     r0 = (-1.0) - (-0.5) = -0.5
    //     r1 = ( 3.0) - ( 1.5) =  1.5
    //   weighted msd = Σ wₖ·rₖ² / W = (3·0.25 + 1·2.25)/4 = (0.75 + 2.25)/4 = 0.75
    //   weighted rmsd = sqrt(0.75) = 0.8660254037844386
    const P = new Float64Array([-1, 0, 0, 1, 0, 0]);
    const Q = new Float64Array([-1, 0, 0, 3, 0, 0]);
    const weights = new Float64Array([3, 1]);

    const weighted = superpose(P, Q, { weights });
    const unweighted = superpose(P, Q);

    const expectedWeightedRmsd = Math.sqrt(0.75);
    expect(weighted.rmsd).toBeCloseTo(expectedWeightedRmsd, 9);
    // The unweighted alignment is a different optimum, so its rmsd differs.
    expect(Math.abs(weighted.rmsd - unweighted.rmsd)).toBeGreaterThan(1e-6);
  });
});

// ── ac-009 rmsd hand value (no internal superposition) ────────────────────────

describe("rmsd (ac-009 measures coords as-is)", () => {
  test("ac-009 rmsd(P, Q) equals the hand-computed value", () => {
    // Two points, measured AS-IS (rmsd must NOT superpose first):
    //   P = [ (0,0,0), (1,0,0) ]   Q = [ (0,0,1), (1,0,0) ]
    //   d0² = 0 + 0 + 1 = 1     d1² = 0
    //   msd = (1 + 0)/2 = 0.5    rmsd = sqrt(0.5) = 0.7071067811865476
    const P = new Float64Array([0, 0, 0, 1, 0, 0]);
    const Q = new Float64Array([0, 0, 1, 1, 0, 0]);
    expect(rmsd(P, Q)).toBeCloseTo(Math.sqrt(0.5), 9);
  });

  test("ac-009 rmsd does NOT superpose: a pure translation still yields nonzero rmsd", () => {
    // Q = P + (10,0,0): a perfect superpose() would give rmsd≈0, but rmsd()
    // reports the raw displacement, so every point is 10 apart ⇒ rmsd = 10.
    const P = TETRA.slice();
    const Q = applyRot(P, IDENTITY3, new Float64Array([10, 0, 0]));
    expect(rmsd(P, Q)).toBeCloseTo(10, 9);
  });
});

// ── ac-010 mismatch error (no silent zip) ─────────────────────────────────────

describe("superpose (ac-010 count mismatch)", () => {
  test("ac-010 unequal point counts with no indices throws naming the mismatch", () => {
    const P = new Float64Array([0, 0, 0, 1, 0, 0, 2, 0, 0]); // N=3
    const Q = new Float64Array([0, 0, 0, 1, 0, 0]); // N=2
    expect(() => superpose(P, Q)).toThrow(/count|length|mismatch/i);
  });
});

// ── ac-011 indices subset ─────────────────────────────────────────────────────

describe("superpose (ac-011 indices subset)", () => {
  test("ac-011 indices subset matches manual extraction of the same points", () => {
    // Full clouds (N=5). The subset {0,2,4} is selected via indices and must
    // give exactly the same R/t/rmsd as calling superpose on extracted arrays.
    const R = matmul3(rotZ(0.4), rotX(0.3));
    const t = new Float64Array([2, -1, 0.5]);
    const P = TETRA.slice();
    const Q = applyRot(P, R, t);
    // perturb so subset != whole and the optimum is non-trivial
    Q[0] += 0.05;
    Q[7] -= 0.03;

    const indices = identityCorrespondence(5, 5); // [0,1,2,3,4]
    expect(Array.from(indices)).toEqual([0, 1, 2, 3, 4]);

    const subset = new Uint32Array([0, 2, 4]);

    // manual extraction of points 0,2,4 from both clouds
    const extract = (pts: Float64Array, idx: Uint32Array): Float64Array => {
      const out = new Float64Array(idx.length * 3);
      idx.forEach((k, i) => {
        out[3 * i] = pts[3 * k];
        out[3 * i + 1] = pts[3 * k + 1];
        out[3 * i + 2] = pts[3 * k + 2];
      });
      return out;
    };

    const viaIndices = superpose(P, Q, { indices: subset });
    const viaManual = superpose(extract(P, subset), extract(Q, subset));

    expect(matsClose(viaIndices.R, viaManual.R, TOL)).toBe(true);
    expect(vecsClose(viaIndices.t, viaManual.t, TOL)).toBe(true);
    expect(viaIndices.rmsd).toBeCloseTo(viaManual.rmsd, 9);
  });
});
