import { describe, expect, it } from "@rstest/core";
import { computeObb, type Obb, symEig3x3 } from "../src/camera/obb";
import type { Vec3 } from "../src/camera/pose";

/** Corners of an axis-aligned box [±hx]×[±hy]×[±hz] centered at `c`. */
function boxCorners(
  hx: number,
  hy: number,
  hz: number,
  c: Vec3 = [0, 0, 0],
): Float64Array {
  const pts: number[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        pts.push(c[0] + sx * hx, c[1] + sy * hy, c[2] + sz * hz);
  return new Float64Array(pts);
}

function isFiniteObb(o: Obb): boolean {
  const all = [...o.center, ...o.halfExtents, ...o.axes.flat()];
  return all.every((x) => Number.isFinite(x));
}

describe("symEig3x3", () => {
  it("recovers eigenvalues (descending) and orthonormal eigenvectors of a diagonal matrix", () => {
    const { values, vectors } = symEig3x3([
      [3, 0, 0],
      [0, 1, 0],
      [0, 0, 2],
    ]);
    expect(values[0]).toBeCloseTo(3, 9);
    expect(values[1]).toBeCloseTo(2, 9);
    expect(values[2]).toBeCloseTo(1, 9);
    // axes[0] ~ x, axes[1] ~ z, axes[2] ~ y (up to sign).
    expect(Math.abs(vectors[0][0])).toBeCloseTo(1, 9);
    expect(Math.abs(vectors[1][2])).toBeCloseTo(1, 9);
    expect(Math.abs(vectors[2][1])).toBeCloseTo(1, 9);
    // Orthonormal.
    for (const v of vectors) {
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 9);
    }
  });

  it("diagonalizes a non-diagonal symmetric matrix", () => {
    // Eigenvalues of [[2,1,0],[1,2,0],[0,0,5]] are 5, 3, 1.
    const { values } = symEig3x3([
      [2, 1, 0],
      [1, 2, 0],
      [0, 0, 5],
    ]);
    expect(values[0]).toBeCloseTo(5, 9);
    expect(values[1]).toBeCloseTo(3, 9);
    expect(values[2]).toBeCloseTo(1, 9);
  });
});

describe("computeObb", () => {
  it("recovers an axis-aligned box's axes and radius-free extents", () => {
    const obb = computeObb(boxCorners(2, 1, 0.5), null);
    expect(obb.degenerate).toBe(false);
    // Major→minor extents track the box dimensions.
    expect(obb.halfExtents[0]).toBeCloseTo(2, 9);
    expect(obb.halfExtents[1]).toBeCloseTo(1, 9);
    expect(obb.halfExtents[2]).toBeCloseTo(0.5, 9);
    expect(obb.center[0]).toBeCloseTo(0, 9);
    expect(obb.center[1]).toBeCloseTo(0, 9);
    expect(obb.center[2]).toBeCloseTo(0, 9);
    // Major axis aligns with x.
    expect(Math.abs(obb.axes[0][0])).toBeCloseTo(1, 9);
  });

  it("expands extents by per-point radii (the radius dropped by getBounds)", () => {
    // Two points along x at ±5 with radius 1 → major extent 6.
    const pts = new Float64Array([-5, 0, 0, 5, 0, 0]);
    const radii = new Float64Array([1, 1]);
    const obb = computeObb(pts, radii);
    // n < 3 → degenerate, axes fall back to world; world-x extent is 5 + 1.
    expect(obb.halfExtents[0]).toBeCloseTo(6, 9);
  });

  it("offsets the box center to the midpoint of the extents", () => {
    // Box centered at (10, -4, 2).
    const obb = computeObb(boxCorners(3, 2, 1, [10, -4, 2]), null);
    expect(obb.center[0]).toBeCloseTo(10, 6);
    expect(obb.center[1]).toBeCloseTo(-4, 6);
    expect(obb.center[2]).toBeCloseTo(2, 6);
  });

  it("is stable on degenerate clouds (single / collinear / isotropic) — no NaN", () => {
    const single = computeObb(new Float64Array([1, 2, 3]), null);
    expect(single.degenerate).toBe(true);
    expect(isFiniteObb(single)).toBe(true);

    const collinear = computeObb(
      new Float64Array([-1, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0]),
      null,
    );
    expect(collinear.degenerate).toBe(true);
    expect(isFiniteObb(collinear)).toBe(true);

    // Isotropic cube → all eigenvalues equal → degenerate.
    const cube = computeObb(boxCorners(1, 1, 1), null);
    expect(cube.degenerate).toBe(true);
    expect(isFiniteObb(cube)).toBe(true);
  });
});
