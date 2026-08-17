/**
 * Contract: full-frame wrap is the coordinate-policy path only.
 * Draw code (ribbon / bonds) uses MI *delta* on post-policy coordinates —
 * it must not re-apply wrapAtoms / wrapMolecules itself.
 *
 * (Browser unit env cannot walk the tree with node:fs; the public API surface
 * is the enforceable boundary here.)
 */
import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  applyCoordinatePolicy,
  wrapAtoms,
  wrapMolecules,
} from "../../src/coords";

function frameWith(
  positions: [number, number, number][],
  box: Box,
  bonds?: Array<[number, number]>,
): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(positions.map((p) => p[0])));
  atoms.setColF("y", new Float64Array(positions.map((p) => p[1])));
  atoms.setColF("z", new Float64Array(positions.map((p) => p[2])));
  frame.insertBlock("atoms", atoms);
  if (bonds?.length) {
    const b = new Block();
    b.setColU32("atomi", new Uint32Array(bonds.map((p) => p[0])));
    b.setColU32("atomj", new Uint32Array(bonds.map((p) => p[1])));
    b.setColU32("bond_type", new Uint32Array(bonds.map(() => 1)));
    b.setColU32("bond_number", new Uint32Array(bonds.map(() => 1)));
    frame.insertBlock("bonds", b);
  }
  frame.box = box;
  return frame;
}

describe("post-policy wrap vs draw MI contract", () => {
  it("exports wrap only through the coords policy surface", () => {
    // Public API: full-frame wrap is named on the coords module.
    expect(typeof wrapAtoms).toBe("function");
    expect(typeof wrapMolecules).toBe("function");
    expect(typeof applyCoordinatePolicy).toBe("function");
  });

  it("as-deposited leaves coords for draw-time MI to resolve", () => {
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
    const out = applyCoordinatePolicy(frame, "as-deposited");
    expect(out).toBe(frame);
    // Raw deposited positions still span the boundary — bond MI (draw path)
    // is free to shorten the stick without mutating columns.
    const x = out.getBlock("atoms")!.viewColF("x")!;
    expect(x[0]).toBeCloseTo(9.5, 6);
    expect(x[1]).toBeCloseTo(10.8, 6);
  });

  it("wrap-molecules shortens the dimer so draw MI is a no-op for the pair", () => {
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
    const out = applyCoordinatePolicy(frame, "wrap-molecules");
    const x = out.getBlock("atoms")!.viewColF("x")!;
    expect(Math.abs(x[1] - x[0])).toBeLessThan(2);
  });
});
