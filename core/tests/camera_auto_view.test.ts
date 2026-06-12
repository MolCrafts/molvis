import { describe, expect, it } from "@rstest/core";
import { pickViewDirection } from "../src/camera/auto_view";
import { viewBasis } from "../src/camera/fit";
import { computeObb } from "../src/camera/obb";

function boxCorners(hx: number, hy: number, hz: number): Float64Array {
  const pts: number[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) pts.push(sx * hx, sy * hy, sz * hz);
  return new Float64Array(pts);
}

describe("pickViewDirection", () => {
  it("looks down the minor axis of an elongated structure (ac-007)", () => {
    const obb = computeObb(boxCorners(10, 4, 0.5), null);
    const { alpha, beta } = pickViewDirection(obb);
    const forward = viewBasis(alpha, beta).forward;
    const minor = obb.axes[2];
    const align = Math.abs(
      forward[0] * minor[0] + forward[1] * minor[1] + forward[2] * minor[2],
    );
    expect(align).toBeCloseTo(1, 6);
  });

  it("falls back to iso angles on a degenerate (isotropic) cloud (ac-009)", () => {
    const cube = computeObb(boxCorners(1, 1, 1), null);
    expect(cube.degenerate).toBe(true);
    const { alpha, beta } = pickViewDirection(cube);
    expect(alpha).toBeCloseTo(Math.PI / 4, 9);
    expect(beta).toBeCloseTo(Math.PI / 3, 9);
  });

  it("returns finite angles for a single-point cloud", () => {
    const single = pickViewDirection(
      computeObb(new Float64Array([1, 2, 3]), null),
    );
    expect(Number.isFinite(single.alpha)).toBe(true);
    expect(Number.isFinite(single.beta)).toBe(true);
  });
});
