/**
 * Contract: full-frame wrap is the system gate only (`applyWrapIfEnabled`).
 * Draw code (ribbon / bonds) uses MI *delta* on post-gate coordinates —
 * it must not re-apply wrapAtoms itself.
 */
import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import { applyWrapIfEnabled, wrapAtoms } from "../../src/coords";

function frameWith(
  positions: [number, number, number][],
  box: Box,
  bonds?: Array<[number, number]>,
): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array(positions.map((p) => p[0])));
  atoms.set("y", new Float64Array(positions.map((p) => p[1])));
  atoms.set("z", new Float64Array(positions.map((p) => p[2])));
  frame.set("atoms", atoms);
  if (bonds?.length) {
    const b = new Block();
    b.set("atomi", toDomainUint(bonds.map((p) => p[0])));
    b.set("atomj", toDomainUint(bonds.map((p) => p[1])));
    b.set("bond_type", toDomainUint(bonds.map(() => 1)));
    b.set("bond_number", toDomainUint(bonds.map(() => 1)));
    frame.set("bonds", b);
  }
  frame.box = box;
  return frame;
}

describe("post-gate wrap vs draw MI contract", () => {
  it("exports wrap only through the coords gate surface", () => {
    expect(typeof wrapAtoms).toBe("function");
    expect(typeof applyWrapIfEnabled).toBe("function");
  });

  it("wrap off leaves coords for draw-time MI to resolve", () => {
    const box = Box.ortho(
      new Float64Array([10, 10, 10]),
      new Float64Array([0, 0, 0]),
      true,
      true,
      true,
    );
    const frame = frameWith(
      [
        [9.5, 5, 5],
        [10.8, 5, 5],
      ],
      box,
      [[0, 1]],
    );
    const out = applyWrapIfEnabled(frame, false);
    expect(out).toBe(frame);
    const x = (out.get("atoms").view("x") as Float64Array)!;
    expect(x[0]).toBeCloseTo(9.5, 6);
    expect(x[1]).toBeCloseTo(10.8, 6);
  });

  it("wrap on folds both dimer ends into the cell", () => {
    const box = Box.ortho(
      new Float64Array([10, 10, 10]),
      new Float64Array([0, 0, 0]),
      true,
      true,
      true,
    );
    const frame = frameWith(
      [
        [9.5, 5, 5],
        [10.8, 5, 5],
      ],
      box,
      [[0, 1]],
    );
    const out = applyWrapIfEnabled(frame, true);
    const x = (out.get("atoms").view("x") as Float64Array)!;
    expect(x[0]).toBeCloseTo(9.5, 6);
    expect(x[1]).toBeCloseTo(0.8, 6);
  });
});
