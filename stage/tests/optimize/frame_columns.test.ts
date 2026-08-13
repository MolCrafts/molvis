import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  copyAtomColumns,
  copyBondColumns,
} from "../../src/optimize/frame_columns";
import { BOND_TYPE_SINGLE, setBondTopology } from "../../src/utils/bond_order";

describe("copyAtomColumns / copyBondColumns", () => {
  it("leaves the Frame getBlock borrow usable after a copy", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([1, 2]));
    atoms.setColF("y", new Float64Array([3, 4]));
    atoms.setColF("z", new Float64Array([5, 6]));
    atoms.setColStr("element", ["C", "O"]);
    frame.insertBlock("atoms", atoms);
    const bonds = new Block();
    setBondTopology(
      bonds,
      new Uint32Array([0]),
      new Uint32Array([1]),
      new Uint32Array([BOND_TYPE_SINGLE]),
      new Uint32Array([BOND_TYPE_SINGLE]),
    );
    frame.insertBlock("bonds", bonds);

    const first = copyAtomColumns(frame);
    expect(first.n).toBe(2);
    expect(first.elements).toEqual(["C", "O"]);
    expect(copyBondColumns(frame).bondI).toEqual(new Uint32Array([0]));

    // Second read must still see the same columns. Freeing the getBlock
    // borrow used to survive only because safeFree swallowed the throw.
    const again = copyAtomColumns(frame);
    expect(again.x[1]).toBeCloseTo(2, 12);
    expect(frame.getBlock("atoms")?.nrows()).toBe(2);
    expect(frame.getBlock("bonds")?.nrows()).toBe(1);
  });
});
