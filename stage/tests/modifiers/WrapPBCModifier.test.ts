import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  WrapPBCModifier,
  wrapMoleculeAware,
} from "../../src/modifiers/WrapPBCModifier";
import { DrawBoxModifier } from "../../src/pipeline/draw_box";
import { createDefaultContext } from "../../src/pipeline/types";

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

function testContext(frame: Frame) {
  return createDefaultContext(frame, {
    styleManager: { getShowBox: () => true },
    artist: { drawBox: () => {} },
  } as never);
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

describe("WrapPBCModifier", () => {
  it("wraps isolated atoms into the primary cell", () => {
    const box = orthoBox(10);
    const frame = makeFrame(
      [
        [12, 1, 1], // → 2
        [-3, 5, 5], // → 7
        [5, 5, 5],
      ],
      box,
    );
    const mod = new WrapPBCModifier("wrap-1");
    const out = mod.apply(frame, testContext(frame));
    const atoms = out.getBlock("atoms")!;
    const x = atoms.viewColF("x")!;
    expect(x[0]).toBeCloseTo(2, 6);
    expect(x[1]).toBeCloseTo(7, 6);
    expect(x[2]).toBeCloseTo(5, 6);
  });

  it("skips when frame has no box", () => {
    const frame = makeFrame([[12, 1, 1]]);
    const mod = new WrapPBCModifier("wrap-2");
    const out = mod.apply(frame, testContext(frame));
    expect(out).toBe(frame);
  });

  it("wraps after a manual Simulation cell has written frame.box", () => {
    const bare = makeFrame([
      [12, 1, 1],
      [-3, 5, 5],
    ]);
    const drawBox = new DrawBoxModifier("draw-box", {
      lengths: [10, 10, 10],
      tilts: [0, 0, 0],
      origin: [0, 0, 0],
      pbc: [true, true, true],
    });
    const withBox = drawBox.apply(bare, testContext(bare));
    const wrap = new WrapPBCModifier("wrap-3");
    const out = wrap.apply(withBox, testContext(withBox));
    const x = out.getBlock("atoms")!.viewColF("x")!;
    expect(x[0]).toBeCloseTo(2, 6);
    expect(x[1]).toBeCloseTo(7, 6);
  });

  it("keeps a bonded molecule intact across a periodic boundary", () => {
    // Dimer straddling x=0/10: atom 0 at 9.5, atom 1 at 10.5 (= −0.5 unwrapped).
    // Per-atom wrap would put them at 9.5 and 0.5 (split across the cell).
    // Molecule wrap must keep ~1 Å bond: both on the same image.
    const box = orthoBox(10);
    const frame = makeFrame(
      [
        [9.5, 0, 0],
        [10.5, 0, 0],
      ],
      box,
      [[0, 1]],
    );
    const mod = new WrapPBCModifier("wrap-mol");
    const out = mod.apply(frame, testContext(frame));
    const atoms = out.getBlock("atoms")!;
    const x = atoms.viewColF("x")!;
    const y = atoms.viewColF("y")!;
    const z = atoms.viewColF("z")!;
    // Bond length preserved under MI-relative placement.
    const dx = x[1] - x[0];
    const dy = y[1] - y[0];
    const dz = z[1] - z[0];
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(1.0, 5);
    // Both ends on the same continuous image (not 9.5 and 0.5).
    expect(Math.abs(dx)).toBeLessThan(2);
  });

  it("wrapMoleculeAware batches pure free atoms", () => {
    const box = orthoBox(10);
    const x = new Float64Array([12, -1]);
    const y = new Float64Array([0, 0]);
    const z = new Float64Array([0, 0]);
    const out = wrapMoleculeAware(box, x, y, z, 2, undefined);
    expect(out.x[0]).toBeCloseTo(2, 6);
    expect(out.x[1]).toBeCloseTo(9, 6);
  });
});
