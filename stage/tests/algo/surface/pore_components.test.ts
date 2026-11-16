/**
 * Periodic pore labels: a pore through a face is one pore, its spanning
 * dimension is the rank of the loops it closes around the torus, and
 * gradient normals do not move a vertex.
 */

import { describe, expect, test } from "@rstest/core";
import { CellDomain } from "../../../src/algo/surface/cell_domain";
import {
  gradientNormals,
  labelPores,
  latticeRank,
  majorityClasses,
  vertexPores,
} from "../../../src/algo/surface/pore_components";

const D = new CellDomain({ origin: [0, 0, 0], lengths: [8, 8, 8] }, 1);

/** Solid everywhere (+1) except the voxels `isVoid` names (−1). */
function field(
  isVoid: (i: number, j: number, k: number) => boolean,
): Float64Array {
  const v = new Float64Array(D.voxelCount);
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++)
      for (let k = 0; k < 8; k++)
        v[D.index(i, j, k)] = isVoid(i, j, k) ? -1 : 1;
  return v;
}

describe("labelPores", () => {
  test("a closed cavity is one pore of dimension 0", () => {
    const r = labelPores(
      D,
      field(
        (i, j, k) => i >= 2 && i <= 3 && j >= 2 && j <= 3 && k >= 2 && k <= 3,
      ),
      0,
    );
    expect(r.pores).toHaveLength(1);
    expect(r.pores[0]).toMatchObject({ voxels: 8, volume: 8, dimension: 0 });
    expect(r.voidFraction).toBeCloseTo(8 / 512, 12);
  });

  test("a cavity cut by a face is still one pore", () => {
    // Voxels at i = 7 and i = 0 touch through the periodic face.
    const r = labelPores(
      D,
      field((i, j, k) => (i === 7 || i === 0) && j === 4 && k === 4),
      0,
    );
    expect(r.pores).toHaveLength(1);
    expect(r.pores[0].dimension).toBe(0);
  });

  test("a channel along x spans in one dimension", () => {
    const r = labelPores(
      D,
      field((_i, j, k) => j === 4 && k === 4),
      0,
    );
    expect(r.pores).toHaveLength(1);
    expect(r.pores[0].dimension).toBe(1);
  });

  test("a slab spans in two, a cross of three channels in three", () => {
    expect(
      labelPores(
        D,
        field((_i, _j, k) => k === 4),
        0,
      ).pores[0].dimension,
    ).toBe(2);
    const cross = labelPores(
      D,
      field(
        (i, j, k) =>
          (j === 4 && k === 4) || (i === 4 && k === 4) || (i === 4 && j === 4),
      ),
      0,
    );
    expect(cross.pores).toHaveLength(1);
    expect(cross.pores[0].dimension).toBe(3);
  });

  test("pores come largest first, labels follow that order", () => {
    const r = labelPores(
      D,
      field(
        (i, j, k) =>
          (i === 1 && j === 1 && k === 1) ||
          (i >= 4 && i <= 5 && j === 5 && k === 5),
      ),
      0,
    );
    expect(r.pores.map((p) => p.voxels)).toEqual([2, 1]);
    expect(r.labels[D.index(4, 5, 5)]).toBe(0);
    expect(r.labels[D.index(1, 1, 1)]).toBe(1);
    expect(r.labels[D.index(0, 0, 0)]).toBe(-1);
  });
});

describe("latticeRank", () => {
  test("counts independent wrap vectors", () => {
    expect(latticeRank([])).toBe(0);
    expect(
      latticeRank([
        [1, 0, 0],
        [2, 0, 0],
      ]),
    ).toBe(1);
    expect(
      latticeRank([
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ]),
    ).toBe(2);
    expect(
      latticeRank([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    ).toBe(3);
  });
});

describe("vertexPores and gradientNormals", () => {
  test("a vertex takes the pore of the centre one probe radius inward", () => {
    // Two centre pores: x = 1 and x = 6 planes. A void field rising toward
    // x = 6 sends a vertex at x = 4.5 three voxels on, into the second.
    const centres = field((i) => i === 1 || i === 6);
    const { labels } = labelPores(D, centres, 0);
    const voidField = new Float64Array(D.voxelCount);
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++)
        for (let k = 0; k < 8; k++)
          voidField[D.index(i, j, k)] = -Math.abs(i - 6);
    const owner = vertexPores(
      new Float32Array([4.5, 3, 3]),
      D,
      voidField,
      labels,
      1.5,
      0,
    );
    expect(Array.from(owner)).toEqual([labels[D.index(6, 3, 3)]]);
  });

  test("normals follow the gradient and keep the flat normal's side", () => {
    // A field rising along +x: its gradient is +x everywhere.
    const values = new Float64Array(D.voxelCount);
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++)
        for (let k = 0; k < 8; k++)
          values[D.index(i, j, k)] = Math.sin((2 * Math.PI * i) / 8);
    const n = gradientNormals(
      new Float32Array([2, 3, 3]),
      new Float32Array([-1, 0, 0]),
      D,
      values,
    );
    // At i = 2 the sine peaks, so the gradient is ~0 along x… use i = 0.
    const m = gradientNormals(
      new Float32Array([0, 3, 3]),
      new Float32Array([-0.9, 0.1, 0]),
      D,
      values,
    );
    expect(m[0]).toBeCloseTo(-1, 6);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
  });
});

describe("majorityClasses", () => {
  test("a lone speck takes its neighbours' class; unknowns join the majority", () => {
    const positions = new Float32Array([
      0, 0, 0, 0.2, 0, 0, 0.4, 0, 0, 0.3, 0.1, 0, 5, 5, 5,
    ]);
    const raw = new Int8Array([0, 0, 1, -1, -1]);
    const out = Array.from(majorityClasses(positions, raw, 0.6));
    expect(out).toEqual([0, 0, 0, 0, 1]);
  });
});
