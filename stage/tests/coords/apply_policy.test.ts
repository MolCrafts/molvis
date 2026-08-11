import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { applyCoordinatePolicy, wrapMolecules } from "../../src/coords";

function makeFrame(
  positions: [number, number, number][],
  box?: Box,
  bonds?: Array<[number, number]>,
): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(positions.map((p) => p[0])));
  atoms.setColF("y", new Float64Array(positions.map((p) => p[1])));
  atoms.setColF("z", new Float64Array(positions.map((p) => p[2])));
  frame.insertBlock("atoms", atoms);
  if (bonds && bonds.length > 0) {
    const b = new Block();
    b.setColU32("atomi", new Uint32Array(bonds.map((p) => p[0])));
    b.setColU32("atomj", new Uint32Array(bonds.map((p) => p[1])));
    b.setColU32("bond_type", new Uint32Array(bonds.map(() => 1)));
    b.setColU32("bond_number", new Uint32Array(bonds.map(() => 1)));
    frame.insertBlock("bonds", b);
  }
  if (box) frame.box = box;
  return frame;
}

function orthoBox(L = 10): Box {
  return Box.ortho(
    new Float64Array([L, L, L]),
    new Float64Array([0, 0, 0]),
    true,
    true,
    true,
  );
}

describe("applyCoordinatePolicy", () => {
  it("as-deposited is a no-op identity", () => {
    const box = orthoBox(10);
    const frame = makeFrame([[12, 1, 1]], box);
    const out = applyCoordinatePolicy(frame, "as-deposited");
    expect(out).toBe(frame);
    expect(out.getBlock("atoms")?.viewColF("x")?.[0]).toBeCloseTo(12, 6);
  });

  it("wrap-atoms folds isolated atoms into the cell", () => {
    const box = orthoBox(10);
    const frame = makeFrame(
      [
        [12, 1, 1],
        [-3, 5, 5],
      ],
      box,
    );
    const out = applyCoordinatePolicy(frame, "wrap-atoms");
    const x = out.getBlock("atoms")!.viewColF("x")!;
    expect(x[0]).toBeCloseTo(2, 6);
    expect(x[1]).toBeCloseTo(7, 6);
  });

  it("wrap-molecules keeps a covalent dimer on one lattice image", () => {
    // Use frame.box only — Frame takes ownership of the Box handle.
    const frame = makeFrame(
      [
        [9.5, 5, 5],
        [10.8, 5, 5],
      ],
      orthoBox(10),
      [[0, 1]],
    );
    const liveBox = frame.box!;
    const pure = wrapMolecules(
      liveBox,
      new Float64Array([9.5, 10.8]),
      new Float64Array([5, 5]),
      new Float64Array([5, 5]),
      2,
      frame.getBlock("bonds")!,
    );
    const out = applyCoordinatePolicy(frame, "wrap-molecules");
    const x = out.getBlock("atoms")!.viewColF("x")!;
    expect(x[0]).toBeCloseTo(pure.x[0], 6);
    expect(x[1]).toBeCloseTo(pure.x[1], 6);
    // Bond image: |x1-x0| should stay ~1.3, not ~8.7
    expect(Math.abs(x[1] - x[0])).toBeLessThan(2);
  });

  it("skips wrap when there is no usable box", () => {
    const frame = makeFrame([[12, 1, 1]]);
    const out = applyCoordinatePolicy(frame, "wrap-atoms");
    expect(out.getBlock("atoms")?.viewColF("x")?.[0]).toBeCloseTo(12, 6);
  });
});
