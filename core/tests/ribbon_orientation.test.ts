import { describe, expect, it } from "@rstest/core";
import { computeSideVectors } from "../src/artist/ribbon/orientation";
import { catmullRomSpline } from "../src/artist/ribbon/spline";

/**
 * Tests for the Carson-Bugg side-vector pipeline. These nail down
 * the spec's "no random face flipping" / "orientation must be
 * continuous" requirements (rules 6.1 / 6.2 / 6.3) at the unit-test
 * level so future refactors can't reintroduce the twisted-leaf
 * artefact.
 */

function ca(coords: number[][]): Float64Array {
  const out = new Float64Array(coords.length * 3);
  for (let i = 0; i < coords.length; i++) {
    out[i * 3] = coords[i][0];
    out[i * 3 + 1] = coords[i][1];
    out[i * 3 + 2] = coords[i][2];
  }
  return out;
}

function dot3(a: Float64Array, i: number, b: Float64Array, j: number): number {
  return a[i] * b[j] + a[i + 1] * b[j + 1] + a[i + 2] * b[j + 2];
}

describe("computeSideVectors", () => {
  it("emits unit-length vectors for a simple zig-zag", () => {
    // Zig-zag in the XY plane — Carson-Bugg cross product points
    // along ±Z at every interior residue.
    const positions = ca([
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
      [3, 1, 0],
      [4, 0, 0],
    ]);
    const sides = computeSideVectors(positions);
    for (let i = 0; i < 5; i++) {
      const k = i * 3;
      const len = Math.sqrt(
        sides[k] * sides[k] +
          sides[k + 1] * sides[k + 1] +
          sides[k + 2] * sides[k + 2],
      );
      expect(len).toBeCloseTo(1, 6);
    }
  });

  it("keeps consecutive vectors in the same hemisphere (no ±180° flips)", () => {
    // Same zig-zag — without sign-correction, alternating curvature
    // would put even-indexed sides at +Z and odd at −Z. The pass-1
    // sign continuity must collapse them all to one sign.
    const positions = ca([
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
      [3, 1, 0],
      [4, 0, 0],
      [5, 1, 0],
    ]);
    const sides = computeSideVectors(positions);
    for (let i = 1; i < 6; i++) {
      const dot = dot3(sides, (i - 1) * 3, sides, i * 3);
      expect(dot).toBeGreaterThan(0);
    }
  });

  it("propagates an interior side to the chain endpoints", () => {
    // Endpoints have no Carson-Bugg formula — they must inherit from
    // the nearest interior residue, not be left as the zero vector.
    const positions = ca([
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
      [3, 1, 0],
    ]);
    const sides = computeSideVectors(positions);
    const headLen = Math.sqrt(
      sides[0] * sides[0] + sides[1] * sides[1] + sides[2] * sides[2],
    );
    const tailLen = Math.sqrt(
      sides[9] * sides[9] + sides[10] * sides[10] + sides[11] * sides[11],
    );
    expect(headLen).toBeCloseTo(1, 6);
    expect(tailLen).toBeCloseTo(1, 6);
  });

  it("falls back to a perpendicular when the chain is exactly straight", () => {
    // No curvature anywhere → Carson-Bugg cross is the zero vector at
    // every residue. The fallback must synthesize a non-zero
    // perpendicular and copy it to every residue.
    const positions = ca([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]);
    const sides = computeSideVectors(positions);
    for (let i = 0; i < 4; i++) {
      const k = i * 3;
      const len = Math.sqrt(
        sides[k] * sides[k] +
          sides[k + 1] * sides[k + 1] +
          sides[k + 2] * sides[k + 2],
      );
      expect(len).toBeCloseTo(1, 6);
      // Must be perpendicular to the (constant) tangent (1, 0, 0).
      expect(Math.abs(sides[k])).toBeLessThan(1e-6);
    }
  });

  it("handles a 2-residue chain without crashing", () => {
    // No interior residues at all → both sides are filled by the
    // straight-chain fallback.
    const positions = ca([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const sides = computeSideVectors(positions);
    expect(sides.length).toBe(6);
    const headLen = Math.sqrt(
      sides[0] * sides[0] + sides[1] * sides[1] + sides[2] * sides[2],
    );
    expect(headLen).toBeCloseTo(1, 6);
  });
});

describe("catmullRomSpline orientation continuity", () => {
  it("produces sample-to-sample side vectors that never flip > 90°", () => {
    // β-strand-like geometry: small lateral offsets along Y that
    // alternate sign (mimicking the alternating C=O direction that
    // used to break the renderer). With Carson-Bugg input the spline
    // output must stay smooth.
    const positions = ca([
      [0, 0, 0],
      [3.8, 0.4, 0],
      [7.6, 0, 0],
      [11.4, 0.4, 0],
      [15.2, 0, 0],
      [19.0, 0.4, 0],
    ]);
    const sides = computeSideVectors(positions);
    const points = catmullRomSpline(positions, sides, 8);
    expect(points.length).toBeGreaterThan(10);
    for (let i = 1; i < points.length; i++) {
      const dot =
        points[i].sx * points[i - 1].sx +
        points[i].sy * points[i - 1].sy +
        points[i].sz * points[i - 1].sz;
      // cos(90°) = 0 — sample-to-sample sign check guarantees dot >= 0.
      expect(dot).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("produces unit tangents and unit sides at every spline sample", () => {
    const positions = ca([
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
      [3, 1, 0],
    ]);
    const sides = computeSideVectors(positions);
    const points = catmullRomSpline(positions, sides, 6);
    for (const p of points) {
      const tLen = Math.sqrt(p.tx * p.tx + p.ty * p.ty + p.tz * p.tz);
      const sLen = Math.sqrt(p.sx * p.sx + p.sy * p.sy + p.sz * p.sz);
      expect(tLen).toBeCloseTo(1, 4);
      expect(sLen).toBeCloseTo(1, 4);
    }
  });

  it("keeps side perpendicular to tangent at every sample", () => {
    const positions = ca([
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
      [3, 1, 0],
      [4, 0, 0],
    ]);
    const sides = computeSideVectors(positions);
    const points = catmullRomSpline(positions, sides, 8);
    for (const p of points) {
      const dot = p.tx * p.sx + p.ty * p.sy + p.tz * p.sz;
      expect(Math.abs(dot)).toBeLessThan(1e-3);
    }
  });
});
