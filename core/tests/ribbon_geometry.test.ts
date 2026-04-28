import { describe, expect, it } from "@rstest/core";
import type { SecondaryStructureType } from "../src/artist/ribbon/pdb_backbone";
import { buildRibbonGeometry } from "../src/artist/ribbon/ribbon_geometry";
import type { SplinePoint } from "../src/artist/ribbon/spline";

/**
 * Reusable RGB triples per spline point. The geometry now takes
 * caller-supplied colors so renderer-level modes (spectrum / by-chain
 * / uniform / ss) can drive vertex color without geometry caring.
 */
const HELIX_COL: [number, number, number] = [0.9, 0.2, 0.3];
const SHEET_COL: [number, number, number] = [0.95, 0.85, 0.1];
const COIL_COL: [number, number, number] = [0.6, 0.6, 0.6];

function colorsFor(ss: SecondaryStructureType[]): [number, number, number][] {
  return ss.map((s) =>
    s === "helix" ? HELIX_COL : s === "sheet" ? SHEET_COL : COIL_COL,
  );
}

function makeSplinePoints(n: number): SplinePoint[] {
  const points: SplinePoint[] = [];
  for (let i = 0; i < n; i++) {
    points.push({
      x: i,
      y: 0,
      z: 0,
      tx: 1,
      ty: 0,
      tz: 0,
      sx: 0,
      sy: 1,
      sz: 0,
      t: i,
    });
  }
  return points;
}

const CROSS_SECTION_SEGMENTS = 16;
const VERTS_PER_RING = CROSS_SECTION_SEGMENTS + 1;

describe("buildRibbonGeometry", () => {
  it("should produce correct vertex count", () => {
    const n = 10;
    const points = makeSplinePoints(n);
    const ss: SecondaryStructureType[] = Array(n).fill("coil");
    const mesh = buildRibbonGeometry(points, ss, colorsFor(ss));

    const expectedVerts = n * VERTS_PER_RING;
    expect(mesh.positions.length).toBe(expectedVerts * 3);
    expect(mesh.normals.length).toBe(expectedVerts * 3);
    expect(mesh.colors.length).toBe(expectedVerts * 4);
  });

  it("should produce correct index count", () => {
    const n = 10;
    const points = makeSplinePoints(n);
    const ss: SecondaryStructureType[] = Array(n).fill("coil");
    const mesh = buildRibbonGeometry(points, ss, colorsFor(ss));

    const expectedQuads = (n - 1) * CROSS_SECTION_SEGMENTS;
    expect(mesh.indices.length).toBe(expectedQuads * 6);
  });

  it("should assign different colors for different secondary structure", () => {
    const n = 4;
    const points = makeSplinePoints(n);
    const ss: SecondaryStructureType[] = ["helix", "helix", "sheet", "coil"];
    const mesh = buildRibbonGeometry(points, ss, colorsFor(ss));

    // First ring (helix) should have different color from third ring (sheet)
    const ring0Color = [mesh.colors[0], mesh.colors[1], mesh.colors[2]];
    const ring2Color = [
      mesh.colors[2 * VERTS_PER_RING * 4],
      mesh.colors[2 * VERTS_PER_RING * 4 + 1],
      mesh.colors[2 * VERTS_PER_RING * 4 + 2],
    ];
    const diff =
      Math.abs(ring0Color[0] - ring2Color[0]) +
      Math.abs(ring0Color[1] - ring2Color[1]) +
      Math.abs(ring0Color[2] - ring2Color[2]);
    expect(diff).toBeGreaterThan(0.1);
  });

  it("should produce valid triangle indices (within vertex bounds)", () => {
    const n = 5;
    const points = makeSplinePoints(n);
    const ss: SecondaryStructureType[] = Array(n).fill("helix");
    const mesh = buildRibbonGeometry(points, ss, colorsFor(ss));

    const maxVertex = n * VERTS_PER_RING;
    for (let i = 0; i < mesh.indices.length; i++) {
      expect(mesh.indices[i]).toBeLessThan(maxVertex);
      expect(mesh.indices[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it("should produce normalized normal vectors", () => {
    const n = 5;
    const points = makeSplinePoints(n);
    const ss: SecondaryStructureType[] = Array(n).fill("coil");
    const mesh = buildRibbonGeometry(points, ss, colorsFor(ss));

    for (let i = 0; i < mesh.normals.length; i += 3) {
      const len = Math.sqrt(
        mesh.normals[i] ** 2 +
          mesh.normals[i + 1] ** 2 +
          mesh.normals[i + 2] ** 2,
      );
      // Allow small tolerance for near-zero normals at degenerate points
      if (len > 0.01) {
        expect(len).toBeCloseTo(1, 2);
      }
    }
  });
});
