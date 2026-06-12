import { describe, expect, it } from "@rstest/core";
import {
  aabbToObb,
  FIT_MIN_DISTANCE,
  FIT_PADDING,
  fitBoxToView,
  viewBasis,
} from "../src/camera/fit";
import { computeObb } from "../src/camera/obb";
import type { Vec3 } from "../src/camera/pose";

const FOV = 0.8;

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

describe("fitBoxToView — per-axis, radius-aware, auto-view", () => {
  // Flat slab 10 × 4 × 0.5 → non-degenerate, world axes, minor = z.
  const slab = computeObb(boxCorners(10, 4, 0.5), null);

  it("auto-view per-axis fit tightens for wide viewports (ac-002)", () => {
    const tanV = Math.tan(FOV / 2);
    const wide = fitBoxToView(slab, FOV, 2, { viewDirection: "auto" });
    // Looking down z the screen sees 10 (x) wide; at aspect 2 it is
    // width-limited: 10 / (2 * tanV) * padding.
    expect(wide.radius).toBeCloseTo((10 / (2 * tanV)) * FIT_PADDING, 4);

    const square = fitBoxToView(slab, FOV, 1, { viewDirection: "auto" });
    expect(wide.radius).toBeLessThan(square.radius);
  });

  it("auto direction aligns the view with the minor axis (ac-007)", () => {
    const fit = fitBoxToView(slab, FOV, 1, { viewDirection: "auto" });
    const basis = viewBasis(fit.direction.alpha, fit.direction.beta);
    const minor = slab.axes[2];
    const align = Math.abs(
      basis.forward[0] * minor[0] +
        basis.forward[1] * minor[1] +
        basis.forward[2] * minor[2],
    );
    expect(align).toBeCloseTo(1, 6);
  });

  it("iso view keeps the stable iso angles (ac-008)", () => {
    const fit = fitBoxToView(slab, FOV, 1, { viewDirection: "iso" });
    expect(fit.direction.alpha).toBeCloseTo(Math.PI / 4, 9);
    expect(fit.direction.beta).toBeCloseTo(Math.PI / 3, 9);
  });

  it("clamps to FIT_MIN_DISTANCE for a tiny scene", () => {
    const tiny = aabbToObb({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0.001, y: 0.001, z: 0.001 },
    });
    expect(fitBoxToView(tiny, FOV, 1).radius).toBe(FIT_MIN_DISTANCE);
  });

  it("never clips: every corner of a tilted box stays within the framed view (ac-005)", () => {
    // Box tilted 45° about z — exactly the case the legacy maxDim fit clipped.
    const a = Math.SQRT1_2;
    const e1: Vec3 = [a, a, 0];
    const e2: Vec3 = [-a, a, 0];
    const e3: Vec3 = [0, 0, 1];
    const h = [12, 3, 3];
    const pts: number[] = [];
    for (const s1 of [-1, 1])
      for (const s2 of [-1, 1])
        for (const s3 of [-1, 1])
          pts.push(
            s1 * h[0] * e1[0] + s2 * h[1] * e2[0] + s3 * h[2] * e3[0],
            s1 * h[0] * e1[1] + s2 * h[1] * e2[1] + s3 * h[2] * e3[1],
            s1 * h[0] * e1[2] + s2 * h[1] * e2[2] + s3 * h[2] * e3[2],
          );
    const points = new Float64Array(pts);
    const obb = computeObb(points, null);
    const aspect = 1.5;
    const fit = fitBoxToView(obb, FOV, aspect, { viewDirection: "iso" });
    const basis = viewBasis(fit.direction.alpha, fit.direction.beta);
    const tanV = Math.tan(FOV / 2);
    const tanH = aspect * tanV;

    for (let i = 0; i < points.length / 3; i++) {
      const vx = points[i * 3] - fit.center.x;
      const vy = points[i * 3 + 1] - fit.center.y;
      const vz = points[i * 3 + 2] - fit.center.z;
      const pr =
        vx * basis.right[0] + vy * basis.right[1] + vz * basis.right[2];
      const pu = vx * basis.up[0] + vy * basis.up[1] + vz * basis.up[2];
      expect(Math.abs(pr)).toBeLessThanOrEqual(fit.radius * tanH + 1e-6);
      expect(Math.abs(pu)).toBeLessThanOrEqual(fit.radius * tanV + 1e-6);
    }
  });
});
