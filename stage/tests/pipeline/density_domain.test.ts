import { describe, expect, it } from "@rstest/core";
import { densityDomainFromAtoms } from "../../src/pipeline/gaussian_density_surface";

describe("densityDomainFromAtoms", () => {
  it("covers the atom AABB with pad and never uses a crystal-cell origin", () => {
    // ASU-style coords outside a [0,100] cell — the density domain must
    // follow the protein, not fold into the primary cell.
    const x = new Float64Array([-30, -20, -25]);
    const y = new Float64Array([-50, -40, -45]);
    const z = new Float64Array([-10, -5, -8]);
    const pad = 3;
    const { origin, h } = densityDomainFromAtoms(x, y, z, 3, pad);

    expect(origin[0]).toBeCloseTo(-30 - pad, 6);
    expect(origin[1]).toBeCloseTo(-50 - pad, 6);
    expect(origin[2]).toBeCloseTo(-10 - pad, 6);
    expect(h[0]).toBeCloseTo(10 + 2 * pad, 6); // maxX-minX + 2pad
    expect(h[4]).toBeCloseTo(10 + 2 * pad, 6);
    expect(h[8]).toBeCloseTo(5 + 2 * pad, 6);
    // Off-diagonal zero (ortho)
    expect(h[1]).toBe(0);
    expect(h[2]).toBe(0);
    expect(h[3]).toBe(0);
  });

  it("gives a minimum edge for a single atom", () => {
    const { origin, h } = densityDomainFromAtoms(
      new Float64Array([1]),
      new Float64Array([2]),
      new Float64Array([3]),
      1,
      2,
    );
    expect(origin[0]).toBeCloseTo(-1, 6);
    expect(h[0]).toBeGreaterThanOrEqual(4);
    expect(h[4]).toBeGreaterThanOrEqual(4);
    expect(h[8]).toBeGreaterThanOrEqual(4);
  });
});
