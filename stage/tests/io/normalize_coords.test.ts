import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { hMatrixFromLammps } from "../../src/io/box_lammps";
import { normalizeAtomCoords } from "../../src/io/normalize_coords";

describe("normalizeAtomCoords", () => {
  it("unscales triclinic fractional coords with the LAMMPS diagonal", () => {
    // LAMMPS dump `xs ys zs` on lx=ly=lz=8, xy=2.
    // Atom at fractional (0, 1, 0) → cartesian (xy, ly, 0) = (2, 8, 0).
    // Using Box.lengths() as ly would write y = |b| ≈ 8.246 instead.
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("xs", new Float64Array([0]));
    atoms.set("ys", new Float64Array([1]));
    atoms.set("zs", new Float64Array([0]));
    frame.set("atoms", atoms);
    frame.box = new Box(
      hMatrixFromLammps([8, 8, 8], [2, 0, 0]),
      new Float64Array([0, 0, 0]),
      true,
      true,
      true,
    );

    normalizeAtomCoords(frame);

    const out = frame.has("atoms") ? frame.get("atoms") : undefined;
    expect(out).toBeTruthy();
    const x = out!.copy("x") as Float64Array;
    const y = out!.copy("y") as Float64Array;
    const z = out!.copy("z") as Float64Array;
    expect(x[0]).toBeCloseTo(2, 12);
    expect(y[0]).toBeCloseTo(8, 12);
    expect(z[0]).toBeCloseTo(0, 12);
  });

  it("leaves canonical x/y/z alone", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([1.5]));
    atoms.set("y", new Float64Array([2.5]));
    atoms.set("z", new Float64Array([3.5]));
    frame.set("atoms", atoms);
    normalizeAtomCoords(frame);
    const out = frame.get("atoms");
    expect((out.copy("x") as Float64Array)[0]).toBeCloseTo(1.5, 12);
    expect((out.copy("y") as Float64Array)[0]).toBeCloseTo(2.5, 12);
    expect((out.copy("z") as Float64Array)[0]).toBeCloseTo(3.5, 12);
  });
});
