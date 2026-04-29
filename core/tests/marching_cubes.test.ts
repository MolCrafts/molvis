/**
 * Marching Cubes tests.
 *
 * Pipeline tested: Float64Array → marchingCubes() → MCMesh.
 *
 * Volumetric data now flows through `frame.getBlock("grid")` (see
 * `core/src/transport/trajectory_worker/frame_codec.ts`). The marching
 * cubes algorithm consumes a flat `Float64Array` directly, so these
 * tests construct sample fields without involving any wrapper type.
 *
 * No BabylonJS dependency — all tests run purely in the rstest environment.
 */

import { describe, expect, test } from "@rstest/core";
import "./setup_wasm";
import { marchingCubes } from "../src/algo/marching_cubes";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Identity cell (unit cube), origin at (0,0,0). */
const UNIT_CELL = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const ZERO_ORIGIN = new Float64Array([0, 0, 0]);

/**
 * Create a flat Float64Array of size nx*ny*nz.
 * fill(fn) calls fn(i, j, k) for each voxel.
 */
function makeField(
  nx: number,
  ny: number,
  nz: number,
  fn: (i: number, j: number, k: number) => number,
): Float64Array {
  const data = new Float64Array(nx * ny * nz);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) data[i * ny * nz + j * nz + k] = fn(i, j, k);
  return data;
}

/** Sphere SDF: positive outside, negative inside. */
function sphereField(
  nx: number,
  ny: number,
  nz: number,
  r: number,
): Float64Array {
  const cx = nx / 2;
  const cy = ny / 2;
  const cz = nz / 2;
  return makeField(
    nx,
    ny,
    nz,
    (i, j, k) => Math.sqrt((i - cx) ** 2 + (j - cy) ** 2 + (k - cz) ** 2) - r,
  );
}

/** Check that no value in a typed float array is NaN or Infinity. */
function hasNoInvalid(arr: Float32Array | Float64Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

// ── Marching Cubes: degenerate cases ─────────────────────────────────────────

describe("marchingCubes — degenerate cases", () => {
  test("all-inside field produces empty mesh", () => {
    const data = new Float64Array(8).fill(-1); // all values < isovalue=0
    const mesh = marchingCubes(data, [2, 2, 2], UNIT_CELL, ZERO_ORIGIN, 0);
    expect(mesh.positions.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });

  test("all-outside field produces empty mesh", () => {
    const data = new Float64Array(8).fill(1); // all values > isovalue=0
    const mesh = marchingCubes(data, [2, 2, 2], UNIT_CELL, ZERO_ORIGIN, 0);
    expect(mesh.positions.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });

  test("single voxel half-inside produces non-empty mesh", () => {
    // 2×2×2 grid: corner 0 inside, rest outside
    const data = new Float64Array(8).fill(1);
    data[0] = -1; // vertex (0,0,0) inside
    const mesh = marchingCubes(data, [2, 2, 2], UNIT_CELL, ZERO_ORIGIN, 0);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
  });
});

// ── Marching Cubes: sphere field ──────────────────────────────────────────────

describe("marchingCubes — sphere field", () => {
  const nx = 20;
  const ny = 20;
  const nz = 20;
  const r = 6; // radius in grid units
  const data = sphereField(nx, ny, nz, r);
  const mesh = marchingCubes(data, [nx, ny, nz], UNIT_CELL, ZERO_ORIGIN, 0);

  test("produces non-empty mesh", () => {
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length).toBeGreaterThan(0);
  });

  test("positions.length is multiple of 3", () => {
    expect(mesh.positions.length % 3).toBe(0);
  });

  test("indices.length is multiple of 3", () => {
    expect(mesh.indices.length % 3).toBe(0);
  });

  test("normals.length equals positions.length", () => {
    expect(mesh.normals.length).toBe(mesh.positions.length);
  });

  test("no NaN or Infinity in positions", () => {
    expect(hasNoInvalid(mesh.positions)).toBe(true);
  });

  test("no NaN or Infinity in normals", () => {
    expect(hasNoInvalid(mesh.normals)).toBe(true);
  });

  test("all indices are within bounds", () => {
    const nVerts = mesh.positions.length / 3;
    for (let i = 0; i < mesh.indices.length; i++) {
      expect(mesh.indices[i]).toBeLessThan(nVerts);
    }
  });

  test("normals are unit length", () => {
    const ns = mesh.normals;
    for (let i = 0; i < ns.length; i += 3) {
      const len = Math.sqrt(ns[i] ** 2 + ns[i + 1] ** 2 + ns[i + 2] ** 2);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  test("vertex positions lie near the sphere surface (unit cell)", () => {
    // In unit cell coords, sphere center is at (nx/2, ny/2, nz/2)/nx = (0.5,0.5,0.5)
    // radius in world coords = r/nx (since cell is identity scaled by 1, not by nx)
    // Actually with identity cell and origin at 0, world pos = frac = grid_index/n
    // So sphere center in world = (0.5, 0.5, 0.5), radius = r/nx = 0.3
    const cx = 0.5;
    const cy = 0.5;
    const cz = 0.5;
    const rWorld = r / nx;
    const ps = mesh.positions;
    let maxErr = 0;
    for (let i = 0; i < ps.length; i += 3) {
      const dx = ps[i] - cx;
      const dy = ps[i + 1] - cy;
      const dz = ps[i + 2] - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      maxErr = Math.max(maxErr, Math.abs(dist - rWorld));
    }
    // MC interpolation error should be < 1 cell width = 1/nx
    expect(maxErr).toBeLessThan(1 / nx);
  });
});

// ── Marching Cubes: coordinate transform ─────────────────────────────────────

describe("marchingCubes — coordinate transform", () => {
  test("axis-aligned plane in x produces vertices at correct x world coords", () => {
    // 4×4×4 field: values = i (linear in i direction)
    // isovalue = 2.0 → surface at i=2, fractional fi=2/4=0.5
    // With cell = diag(2,2,2): world_x = 0 + fi*2 = 1.0
    const nx = 4;
    const ny = 4;
    const nz = 4;
    const data = makeField(nx, ny, nz, (i) => i as number);
    const cell = new Float64Array([2, 0, 0, 0, 2, 0, 0, 0, 2]);
    const mesh = marchingCubes(data, [nx, ny, nz], cell, ZERO_ORIGIN, 2.0);

    expect(mesh.positions.length).toBeGreaterThan(0);
    const ps = mesh.positions;
    for (let i = 0; i < ps.length; i += 3) {
      // All vertices should have x ≈ 1.0 (isovalue=2 at fractional 0.5, world=0.5*2=1)
      expect(ps[i]).toBeCloseTo(1.0, 3);
    }
  });

  test("non-unit origin shifts all vertex positions", () => {
    const nx = 4;
    const ny = 4;
    const nz = 4;
    const data = makeField(nx, ny, nz, (i) => i as number);
    const origin = new Float64Array([10, 20, 30]);
    const mesh0 = marchingCubes(
      data,
      [nx, ny, nz],
      UNIT_CELL,
      ZERO_ORIGIN,
      2.0,
    );
    const meshO = marchingCubes(data, [nx, ny, nz], UNIT_CELL, origin, 2.0);

    expect(mesh0.positions.length).toBe(meshO.positions.length);
    for (let i = 0; i < mesh0.positions.length; i += 3) {
      expect(meshO.positions[i]).toBeCloseTo(mesh0.positions[i] + 10, 3);
      expect(meshO.positions[i + 1]).toBeCloseTo(
        mesh0.positions[i + 1] + 20,
        3,
      );
      expect(meshO.positions[i + 2]).toBeCloseTo(
        mesh0.positions[i + 2] + 30,
        3,
      );
    }
  });
});

// ── End-to-end: Float64Array → MC ─────────────────────────────────────────────

describe("marchingCubes end-to-end", () => {
  test("sphere field produces a valid isosurface", () => {
    const nx = 16;
    const ny = 16;
    const nz = 16;
    const r = 5;
    const data = sphereField(nx, ny, nz, r);

    const mesh = marchingCubes(data, [nx, ny, nz], UNIT_CELL, ZERO_ORIGIN, 0);

    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    expect(hasNoInvalid(mesh.positions)).toBe(true);
    expect(hasNoInvalid(mesh.normals)).toBe(true);

    const nVerts = mesh.positions.length / 3;
    for (let i = 0; i < mesh.indices.length; i++) {
      expect(mesh.indices[i]).toBeLessThan(nVerts);
    }
  });
});
