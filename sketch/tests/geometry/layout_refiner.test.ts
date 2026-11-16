import { describe, expect, it } from "@rstest/core";
import { refineLayout } from "../../src/geometry/layout_refiner";

type P = { x: number; y: number };

function dist(a: P, b: P): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("refineLayout", () => {
  it("leaves an uncrowded layout alone and does not modify its input", () => {
    // Propane zig-zag.
    const points: P[] = [
      { x: 0, y: 0 },
      { x: Math.cos(Math.PI / 6), y: 0.5 },
      { x: 2 * Math.cos(Math.PI / 6), y: 0 },
    ];
    const snapshot = points.map((p) => ({ ...p }));
    const bonds: Array<[number, number]> = [
      [0, 1],
      [1, 2],
    ];
    const out = refineLayout(points, bonds, bonds, 1);
    expect(points).toEqual(snapshot);
    out.forEach((p, k) => {
      expect(dist(p, snapshot[k])).toBeLessThan(1e-12);
    });
  });

  it("turns a branch off an atom it was drawn on top of", () => {
    // 0 carries the branch 1 → 2 and the lone atom 3, drawn almost onto 2.
    const angle = (40 * Math.PI) / 180;
    const points: P[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: Math.cos(angle), y: Math.sin(angle) },
    ];
    const bonds: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [0, 3],
    ];
    expect(dist(points[2], points[3])).toBeLessThan(0.5);
    const out = refineLayout(points, bonds, bonds, 1);
    expect(dist(out[2], out[3])).toBeGreaterThan(0.95);
    for (const [i, j] of bonds) expect(dist(out[i], out[j])).toBeCloseTo(1, 9);
  });

  it("never bends an sp centre", () => {
    // 0-1-2 straight (1 is sp); 2 → 3 and 0 → 4 → 5 put 3 and 5 together.
    const h = Math.sqrt(3) / 2;
    const points: P[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1.5, y: -h },
      { x: 0.5, y: -h },
      { x: 1.5, y: -h },
    ];
    const bonds: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 4],
      [4, 5],
    ];
    const out = refineLayout(points, bonds, bonds, 1, new Set([1]));
    expect(dist(out[3], out[5])).toBeGreaterThan(0.95);
    const cross =
      (out[1].x - out[0].x) * (out[2].y - out[0].y) -
      (out[1].y - out[0].y) * (out[2].x - out[0].x);
    expect(Math.abs(cross)).toBeLessThan(1e-9);
  });
});
