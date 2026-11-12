import { toDomainUint, toRowIndex } from "@molcrafts/molvis-core";
import { Block, Box, Cell, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { BondTopology } from "../../src/artist/bond_topology";
import { ReplicateModifier } from "../../src/modifiers/ReplicateModifier";
import { createDefaultContext } from "../../src/pipeline/types";

function twoAtomBox(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array([0, 1]));
  atoms.set("y", new Float64Array([0, 0]));
  atoms.set("z", new Float64Array([0, 0]));
  atoms.set("element", ["H", "C"]);
  frame.set("atoms", atoms);
  const bonds = new Block();
  bonds.set("atomi", toDomainUint([0]));
  bonds.set("atomj", toDomainUint([1]));
  frame.set("bonds", bonds);
  frame.box = new Box(
    Cell.lengths(new Float64Array([10, 10, 10])),
    new Float64Array(3),
    [true, true, true],
  );
  return frame;
}

describe("ReplicateModifier", () => {
  const mockApp = {} as MolvisApp;

  test("nx=2 doubles atom and bond counts", () => {
    const frame = twoAtomBox();
    const mod = new ReplicateModifier();
    mod.setCounts(2, 1, 1);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(out.get("atoms").nRows).toBe(4);
    expect(out.get("bonds").nRows).toBe(2);
    const x = out.get("atoms").view("x") as Float64Array;
    // Second image shifted by +10 along a (cube edge)
    expect(x?.[2]).toBeCloseTo(10, 5);
    expect(x?.[3]).toBeCloseTo(11, 5);
    // Stored pair is already the nearest image, so each copy stays inside itself.
    expect(bondPairs(out)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  test("1×1×1 is pass-through identity counts", () => {
    const frame = twoAtomBox();
    const mod = new ReplicateModifier();
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(out).toBe(frame);
    expect(out.get("atoms").nRows).toBe(2);
  });

  test("no box skips", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0]));
    atoms.set("y", new Float64Array([0]));
    atoms.set("z", new Float64Array([0]));
    atoms.set("element", ["H"]);
    frame.set("atoms", atoms);
    const mod = new ReplicateModifier();
    mod.setCounts(2, 1, 1);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(out.get("atoms").nRows).toBe(1);
  });

  test("a bond across the cell joins the neighboring replica", () => {
    // L=10. Atoms 0–1 are an ordinary bond. Atoms 2–3 sit at x=1 and x=9:
    // the stored vector is +8, the minimum image is −2, so j belongs one
    // cell to the left of i (k = +1). nx=3 makes +1 and −1 different replicas.
    const frame = placedFrame(
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 0],
        [9, 0, 0],
      ],
      [10, 10, 10],
      [
        [0, 1],
        [2, 3],
      ],
    );
    frame.get("bonds").set("bond_type", toDomainUint([1, 4]));
    frame.get("bonds").set("bond_number", toDomainUint([1, 0]));

    const out = replicate(frame, 3, 1, 1);
    expect(out.get("atoms").nRows).toBe(12);
    expect(bondPairs(out)).toEqual([
      [0, 1],
      [2, 11],
      [4, 5],
      [6, 3],
      [8, 9],
      [10, 7],
    ]);
    // Image 1's atom i (x=11) to image 0's atom j (x=9): the chemical bond.
    expect(separation(out, 6, 3)).toBeCloseTo(2, 5);
    const bonds = out.get("bonds");
    const bondType = bonds.view("bond_type") as BigUint64Array;
    const bondNumber = bonds.view("bond_number") as BigUint64Array;
    expect(toRowIndex(bondType[1])).toBe(4);
    expect(toRowIndex(bondNumber[1])).toBe(0);
    expect(toRowIndex(bondType[3])).toBe(4);
    expect(toRowIndex(bondNumber[3])).toBe(0);
  });

  test("the opposite crossing joins the replica on the other side", () => {
    // i at x=9, j at x=1: k = −1, so j's replica is one cell to the right.
    const frame = placedFrame(
      [
        [9, 0, 0],
        [1, 0, 0],
      ],
      [10, 10, 10],
    );
    const out = replicate(frame, 3, 1, 1);
    expect(bondPairs(out)).toEqual([
      [0, 3],
      [2, 5],
      [4, 1],
    ]);
    expect(separation(out, 0, 3)).toBeCloseTo(2, 5);
  });

  test.each([
    true,
    false,
  ])("respects a translated cell with x periodicity %s", (periodic) => {
    const frame = placedFrame(
      [
        [101, 21, 31],
        [109, 21, 31],
      ],
      [10, 10, 10],
    );
    frame.box = new Box(
      Cell.lengths(new Float64Array([10, 10, 10])),
      new Float64Array([100, 20, 30]),
      [periodic, true, true],
    );
    const out = replicate(frame, 3, 1, 1);
    expect(bondPairs(out)).toEqual(
      periodic
        ? [
            [0, 5],
            [2, 1],
            [4, 3],
          ]
        : [
            [0, 1],
            [2, 3],
            [4, 5],
          ],
    );
  });

  test("a tilted cell uses the lattice vector, not the cartesian axis", () => {
    // Columns of H: a=(10,0,0), b=(5,10,0), c=(0,0,10).
    // j − i − b = (−1,−2,0), so k=(0,1,0). ny=3 distinguishes the sign.
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0, 4]));
    atoms.set("y", new Float64Array([1, 9]));
    atoms.set("z", new Float64Array([0, 0]));
    atoms.set("element", ["C", "C"]);
    frame.set("atoms", atoms);
    const bonds = new Block();
    bonds.set("atomi", toDomainUint([0]));
    bonds.set("atomj", toDomainUint([1]));
    frame.set("bonds", bonds);
    frame.box = new Box(
      Cell.matrix(new Float64Array([10, 5, 0, 0, 10, 0, 0, 0, 10])),
      new Float64Array(3),
      [true, true, true],
    );

    const out = replicate(frame, 1, 3, 1);
    expect(bondPairs(out)).toEqual([
      [0, 5],
      [2, 1],
      [4, 3],
    ]);
    const interior = delta(out, 2, 1);
    expect(interior[0]).toBeCloseTo(-1, 5);
    expect(interior[1]).toBeCloseTo(-2, 5);
    expect(interior[2]).toBeCloseTo(0, 5);
  });
});

function replicate(frame: Frame, nx: number, ny: number, nz: number): Frame {
  const mod = new ReplicateModifier();
  mod.setCounts(nx, ny, nz);
  return mod.apply(frame, createDefaultContext(frame, {} as MolvisApp));
}

function placedFrame(
  xyz: Array<[number, number, number]>,
  lengths: [number, number, number],
  pairs: Array<[number, number]> = [[0, 1]],
): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array(xyz.map((p) => p[0])));
  atoms.set("y", new Float64Array(xyz.map((p) => p[1])));
  atoms.set("z", new Float64Array(xyz.map((p) => p[2])));
  atoms.set(
    "element",
    xyz.map(() => "C"),
  );
  frame.set("atoms", atoms);
  const bonds = new Block();
  bonds.set("atomi", toDomainUint(pairs.map((p) => p[0])));
  bonds.set("atomj", toDomainUint(pairs.map((p) => p[1])));
  frame.set("bonds", bonds);
  frame.box = new Box(
    Cell.lengths(new Float64Array(lengths)),
    new Float64Array(3),
    [true, true, true],
  );
  return frame;
}

function bondPairs(frame: Frame): Array<[number, number]> {
  const topology = BondTopology.of(frame.get("bonds"));
  if (!topology) throw new Error("bonds block has no atomi/atomj");
  const pairs: Array<[number, number]> = [];
  for (let b = 0; b < topology.bondCount; b++) {
    pairs.push([topology.atomi[b], topology.atomj[b]]);
  }
  return pairs;
}

function delta(frame: Frame, i: number, j: number): [number, number, number] {
  const atoms = frame.get("atoms");
  const x = atoms.view("x") as Float64Array;
  const y = atoms.view("y") as Float64Array;
  const z = atoms.view("z") as Float64Array;
  return [x[j] - x[i], y[j] - y[i], z[j] - z[i]];
}

function separation(frame: Frame, i: number, j: number): number {
  const [dx, dy, dz] = delta(frame, i, j);
  return Math.hypot(dx, dy, dz);
}
