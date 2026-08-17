import { describe, expect, it } from "@rstest/core";
import {
  type Point2D,
  pointInPolygon,
  simplifyPolyline,
} from "../../src/selection/fence";

describe("pointInPolygon", () => {
  // Simple square: (0,0), (10,0), (10,10), (0,10)
  const square: Point2D[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("should return true for point inside square", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it("should return false for point outside square", () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: 5, y: -1 }, square)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 11 }, square)).toBe(false);
  });

  it("should return true for point near center", () => {
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true);
    expect(pointInPolygon({ x: 9, y: 9 }, square)).toBe(true);
  });

  // L-shaped polygon (concave)
  const lShape: Point2D[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 10 },
    { x: 0, y: 10 },
  ];

  it("should handle concave polygon (L-shape)", () => {
    // Inside the bottom of the L
    expect(pointInPolygon({ x: 8, y: 2 }, lShape)).toBe(true);
    // Inside the left arm of the L
    expect(pointInPolygon({ x: 2, y: 8 }, lShape)).toBe(true);
    // In the concave cut-out (outside)
    expect(pointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false);
  });

  // Triangle
  const triangle: Point2D[] = [
    { x: 5, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("should work with triangle", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, triangle)).toBe(true);
    expect(pointInPolygon({ x: 1, y: 1 }, triangle)).toBe(false);
  });

  it("should return false for fewer than 3 vertices", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(
      pointInPolygon({ x: 0, y: 0 }, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(false);
  });

  // Star shape (complex concave)
  it("should handle star polygon", () => {
    const star: Point2D[] = [
      { x: 5, y: 0 },
      { x: 6, y: 4 },
      { x: 10, y: 4 },
      { x: 7, y: 6.5 },
      { x: 8, y: 10 },
      { x: 5, y: 8 },
      { x: 2, y: 10 },
      { x: 3, y: 6.5 },
      { x: 0, y: 4 },
      { x: 4, y: 4 },
    ];
    // Center should be inside
    expect(pointInPolygon({ x: 5, y: 5 }, star)).toBe(true);
    // Far outside
    expect(pointInPolygon({ x: 20, y: 20 }, star)).toBe(false);
  });
});

describe("simplifyPolyline", () => {
  it("should return same points for short polylines", () => {
    const pts: Point2D[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    const result = simplifyPolyline(pts, 5);
    expect(result.length).toBe(2);
  });

  it("should remove points within tolerance", () => {
    const pts: Point2D[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 }, // within tolerance of first
      { x: 1, y: 1 }, // within tolerance of first
      { x: 10, y: 10 }, // far enough
    ];
    const result = simplifyPolyline(pts, 5);
    // first (0,0) and (10,10) — last input equals last kept, not duplicated
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 10, y: 10 });
  });

  it("should keep first and last points", () => {
    const pts: Point2D[] = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ];
    const result = simplifyPolyline(pts, 100);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 0.2, y: 0.2 });
  });

  it("should keep all points when tolerance is 0", () => {
    const pts: Point2D[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    const result = simplifyPolyline(pts, 0);
    expect(result.length).toBe(4);
  });

  it("should handle empty array", () => {
    expect(simplifyPolyline([], 5).length).toBe(0);
  });

  it("should handle single point", () => {
    const result = simplifyPolyline([{ x: 5, y: 5 }], 5);
    expect(result.length).toBe(1);
  });
});
