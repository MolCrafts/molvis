import { describe, expect, it } from "@rstest/core";
import { catmullRomSpline } from "../../../src/artist/ribbon/spline";

describe("catmullRomSpline", () => {
  it("should return empty array for fewer than 2 points", () => {
    const positions = new Float64Array([1, 2, 3]);
    const normals = new Float64Array([0, 1, 0]);
    const result = catmullRomSpline(positions, normals, 4);
    expect(result.length).toBe(0);
  });

  it("should include last control point", () => {
    // Two points along X axis
    const positions = new Float64Array([0, 0, 0, 10, 0, 0]);
    const normals = new Float64Array([0, 1, 0, 0, 1, 0]);
    const result = catmullRomSpline(positions, normals, 4);

    const last = result[result.length - 1];
    expect(last.x).toBeCloseTo(10, 3);
    expect(last.y).toBeCloseTo(0, 3);
    expect(last.z).toBeCloseTo(0, 3);
    expect(last.t).toBe(1);
  });

  it("should produce subdivisions + 1 points for 2 control points", () => {
    const positions = new Float64Array([0, 0, 0, 1, 0, 0]);
    const normals = new Float64Array([0, 1, 0, 0, 1, 0]);
    const subdivisions = 8;
    const result = catmullRomSpline(positions, normals, subdivisions);

    // subdivisions interpolation points + 1 endpoint
    expect(result.length).toBe(subdivisions + 1);
  });

  it("should interpolate along a straight line", () => {
    // Three collinear points along X axis
    const positions = new Float64Array([0, 0, 0, 5, 0, 0, 10, 0, 0]);
    const normals = new Float64Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const result = catmullRomSpline(positions, normals, 4);

    // All points should have y ≈ 0 and z ≈ 0
    for (const pt of result) {
      expect(Math.abs(pt.y)).toBeLessThan(0.01);
      expect(Math.abs(pt.z)).toBeLessThan(0.01);
    }
  });

  it("should produce normalized tangent vectors", () => {
    const positions = new Float64Array([0, 0, 0, 3, 4, 0, 6, 0, 0]);
    const normals = new Float64Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const result = catmullRomSpline(positions, normals, 4);

    for (const pt of result) {
      const len = Math.sqrt(pt.tx ** 2 + pt.ty ** 2 + pt.tz ** 2);
      expect(len).toBeCloseTo(1, 3);
    }
  });

  it("parameter t should monotonically increase", () => {
    const positions = new Float64Array([0, 0, 0, 1, 1, 0, 2, 0, 0, 3, 1, 0]);
    const normals = new Float64Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const result = catmullRomSpline(positions, normals, 4);

    for (let i = 1; i < result.length; i++) {
      expect(result[i].t).toBeGreaterThan(result[i - 1].t);
    }
  });
});
