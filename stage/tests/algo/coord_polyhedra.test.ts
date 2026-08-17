import { describe, expect, test } from "@rstest/core";
import { buildPolyhedronEdges } from "../../src/algo/coord_polyhedra";

describe("buildPolyhedronEdges", () => {
  test("center with 3 neighbors yields spokes + triangle edges", () => {
    // tetrahedron-ish: center 0, neighbors 1,2,3
    const positions = new Float64Array([
      0,
      0,
      0, // 0
      1,
      0,
      0, // 1
      0,
      1,
      0, // 2
      0,
      0,
      1, // 3
    ]);
    const edges = buildPolyhedronEdges(positions, [0], [[1, 2, 3]]);
    // 3 spokes + 3 face edges = 6
    expect(edges.length).toBe(6);
  });

  test("empty neighbors yields no edges", () => {
    const positions = new Float64Array([0, 0, 0]);
    expect(buildPolyhedronEdges(positions, [0], [[]]).length).toBe(0);
  });
});
