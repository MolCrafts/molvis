/**
 * The periodic cell domain: CellDomain, the folded ball field, the periodic
 * distance transform, SES on a cell, and the face caps.
 *
 * Every check has an exact answer: a field on a periodic cell must not
 * change when an atom moves by a whole box length, an atom on a face must
 * reach through to the opposite face, and the caps of a fully solid cell
 * must cover all six faces.
 */

import { describe, expect, test } from "@rstest/core";
import { AtomRadii, BONDI_RADII } from "../../../src/algo/surface/atom_radii";
import { BallField } from "../../../src/algo/surface/ball_field";
import { cellCaps } from "../../../src/algo/surface/cell_caps";
import { CellDomain } from "../../../src/algo/surface/cell_domain";
import { EuclideanDistanceTransform } from "../../../src/algo/surface/distance_transform";
import { MAX_VOXELS } from "../../../src/algo/surface/grid_domain";
import { SolventSurface } from "../../../src/algo/surface/solvent_surface";
import type { SurfaceMesh } from "../../../src/algo/surface_mesh";

const CELL = { origin: [0, 0, 0], lengths: [10, 12, 8] } as const;

function meshArea(mesh: SurfaceMesh): number {
  const p = mesh.positions;
  let area = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [
      mesh.indices[t],
      mesh.indices[t + 1],
      mesh.indices[t + 2],
    ];
    const u = [
      p[3 * b] - p[3 * a],
      p[3 * b + 1] - p[3 * a + 1],
      p[3 * b + 2] - p[3 * a + 2],
    ];
    const v = [
      p[3 * c] - p[3 * a],
      p[3 * c + 1] - p[3 * a + 1],
      p[3 * c + 2] - p[3 * a + 2],
    ];
    area +=
      0.5 *
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      );
  }
  return area;
}

describe("CellDomain", () => {
  test("divides each edge into a whole number of voxels", () => {
    const d = new CellDomain(CELL, 0.5);
    expect(d.shape).toEqual([20, 24, 16]);
    expect(d.steps).toEqual([0.5, 0.5, 0.5]);
    expect(d.periodic).toBe(true);
    expect(Array.from(d.cell)).toEqual([10, 0, 0, 0, 12, 0, 0, 0, 8]);
  });

  test("an edge that is not a multiple of the spacing gets its own step", () => {
    const d = new CellDomain(
      { origin: [1, 2, 3], lengths: [10.3, 10, 10] },
      0.5,
    );
    expect(d.nx).toBe(21);
    expect(d.steps[0] * d.nx).toBeCloseTo(10.3, 12);
    // `spacing` reports the coarsest axis.
    expect(d.spacing).toBeCloseTo(0.5, 12);
  });

  test("coarsens past the voxel ceiling and says so", () => {
    const d = new CellDomain(
      { origin: [0, 0, 0], lengths: [200, 200, 200] },
      0.1,
    );
    expect(d.voxelCount).toBeLessThanOrEqual(MAX_VOXELS);
    expect(d.clamped).toBe(true);
  });

  test("refuses a degenerate cell", () => {
    expect(
      () => new CellDomain({ origin: [0, 0, 0], lengths: [0, 1, 1] }, 0.5),
    ).toThrow();
  });
});

describe("BallField on a cell", () => {
  test("an atom on a face reaches through to the opposite face", () => {
    const d = new CellDomain(CELL, 0.5);
    const f = new BallField(d, {
      x: [0],
      y: [6],
      z: [4],
      count: 1,
      radii: [1.5],
    });
    // Voxel nx−1 is 0.5 Å from the atom through the x = 0 face.
    expect(f.values[d.index(d.nx - 1, 12, 8)]).toBeCloseTo(1.0, 12);
    expect(f.values[d.index(1, 12, 8)]).toBeCloseTo(1.0, 12);
  });

  test("moving an atom by a whole box length changes nothing", () => {
    const d = new CellDomain(CELL, 0.5);
    const a = new BallField(d, {
      x: [2.3],
      y: [11.6],
      z: [0.2],
      count: 1,
      radii: [1.7],
    });
    const b = new BallField(d, {
      x: [12.3],
      y: [-0.4],
      z: [-7.8],
      count: 1,
      radii: [1.7],
    });
    for (let i = 0; i < a.values.length; i++) {
      expect(b.values[i]).toBeCloseTo(a.values[i], 9);
    }
  });
});

describe("periodic distance transform", () => {
  test("matches a minimum-image brute force on an anisotropic grid", () => {
    const shape: [number, number, number] = [7, 5, 6];
    const steps: [number, number, number] = [0.5, 0.7, 0.4];
    const seeds = new Uint8Array(7 * 5 * 6);
    const seedList = [
      [0, 0, 0],
      [6, 4, 2],
      [3, 1, 5],
    ];
    for (const [i, j, k] of seedList) seeds[(i * 5 + j) * 6 + k] = 1;
    const { distances } = new EuclideanDistanceTransform(
      shape,
      steps,
      seeds,
      true,
    );
    const image = (d: number, n: number) =>
      Math.min(Math.abs(d), n - Math.abs(d));
    for (let i = 0; i < 7; i++)
      for (let j = 0; j < 5; j++)
        for (let k = 0; k < 6; k++) {
          let best = Number.POSITIVE_INFINITY;
          for (const [si, sj, sk] of seedList) {
            const d = Math.hypot(
              image(i - si, 7) * steps[0],
              image(j - sj, 5) * steps[1],
              image(k - sk, 6) * steps[2],
            );
            best = Math.min(best, d);
          }
          expect(distances[(i * 5 + j) * 6 + k]).toBeCloseTo(best, 9);
        }
  });

  test("an aperiodic grid with one spacing is unchanged", () => {
    const seeds = new Uint8Array(4 * 4 * 4);
    seeds[0] = 1;
    const { distances } = new EuclideanDistanceTransform([4, 4, 4], 0.5, seeds);
    expect(distances[(3 * 4 + 3) * 4 + 3]).toBeCloseTo(Math.sqrt(27) * 0.5, 12);
  });
});

describe("SolventSurface on a cell", () => {
  test("ses of a lone atom across a corner is its vdW sphere", () => {
    const s = new SolventSurface(
      { x: [0], y: [0], z: [0], count: 1, elements: ["C"] },
      {
        mode: "ses",
        resolution: 0.25,
        probeRadius: 1.4,
        radiusScale: 1,
        radiusSet: "bondi",
        cell: CELL,
      },
    );
    const d = s.domain;
    // Walk −x from the corner, i.e. +x from the opposite face inwards.
    let crossing = Number.NaN;
    for (let i = 0; i < d.nx - 1; i++) {
      const a = s.values[d.index((d.nx - i) % d.nx, 0, 0)];
      const b = s.values[d.index(d.nx - i - 1, 0, 0)];
      if (a > 0 && b <= 0) {
        crossing = (i + a / (a - b)) * d.steps[0];
        break;
      }
    }
    expect(crossing).toBeCloseTo(BONDI_RADII.C, 1);
  });

  test("bondi radii are the free-volume set", () => {
    const r = new AtomRadii(4, ["H", "C", "O", "Br"], {
      scale: 1,
      set: "bondi",
    });
    expect(Array.from(r.values)).toEqual([1.2, 1.7, 1.52, 1.85]);
    const odd = new AtomRadii(1, ["Bi"], { scale: 1, set: "bondi" });
    expect(odd.missing).toEqual(["Bi"]);
  });
});

describe("cellCaps", () => {
  test("a fully solid cell is capped on all six faces", () => {
    const d = new CellDomain(CELL, 1);
    const caps = cellCaps(d, new Float64Array(d.voxelCount).fill(1), 0);
    const [lx, ly, lz] = CELL.lengths;
    expect(meshArea(caps)).toBeCloseTo(2 * (ly * lz + lx * lz + lx * ly), 9);
  });

  test("an empty cell has no caps", () => {
    const d = new CellDomain(CELL, 1);
    const caps = cellCaps(d, new Float64Array(d.voxelCount).fill(-1), 0);
    expect(caps.indices.length).toBe(0);
  });

  test("caps face out of the cell", () => {
    const d = new CellDomain(CELL, 1);
    const caps = cellCaps(d, new Float64Array(d.voxelCount).fill(1), 0);
    const p = caps.positions;
    const centre = [5, 6, 4];
    for (let t = 0; t < caps.indices.length; t += 3) {
      const [a, b, c] = [
        caps.indices[t],
        caps.indices[t + 1],
        caps.indices[t + 2],
      ];
      const u = [0, 1, 2].map((k) => p[3 * b + k] - p[3 * a + k]);
      const v = [0, 1, 2].map((k) => p[3 * c + k] - p[3 * a + k]);
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const out = [0, 1, 2].map((k) => p[3 * a + k] - centre[k]);
      expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0);
    }
  });

  test("a solid slab caps only its own cross-section", () => {
    const d = new CellDomain({ origin: [0, 0, 0], lengths: [8, 8, 8] }, 1);
    const values = new Float64Array(d.voxelCount);
    // Solid where x < 4 (voxels 0..4 at +0.5, the rest −0.5): crossing at x = 4.5.
    for (let i = 0; i < d.nx; i++)
      for (let j = 0; j < d.ny; j++)
        for (let k = 0; k < d.nz; k++)
          values[d.index(i, j, k)] = i <= 4 ? 0.5 : -0.5;
    const caps = cellCaps(d, values, 0);
    // x faces: full 8×8 each. y and z faces: solid from x = 0 to 4.5, and from
    // the periodic crossing between voxel 7 and 8 ≡ 0 at x = 7.5 to 8.
    const strip = 4.5 + 0.5;
    expect(meshArea(caps)).toBeCloseTo(2 * 64 + 4 * 8 * strip, 9);
  });
});
