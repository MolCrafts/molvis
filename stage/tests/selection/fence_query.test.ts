import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { AtomSource, BondSource } from "../../src/entity_source";
import {
  fenceAtomWorldPoints,
  fenceBondWorldPoints,
  selectIdsInPolygon,
} from "../../src/selection/fence_query";

describe("fenceAtomWorldPoints", () => {
  it("includes edit-only atoms when the trajectory frame is empty", () => {
    // Repro: sketch / place / draw put atoms only in the edit overlay.
    // Fence used to read system.frame and returned [] for atoms while bonds
    // (already metaRegistry-backed) still selected.
    const atoms = new AtomSource();
    atoms.setEdit(10, {
      type: "atom",
      atomId: 10,
      element: "C",
      position: { x: 1, y: 2, z: 3 },
    });
    atoms.setEdit(11, {
      type: "atom",
      atomId: 11,
      element: "O",
      position: { x: 4, y: 5, z: 6 },
    });

    const points = fenceAtomWorldPoints(atoms);
    expect(points).toEqual([
      { id: 10, x: 1, y: 2, z: 3 },
      { id: 11, x: 4, y: 5, z: 6 },
    ]);
  });

  it("includes frame atoms and edit-only atoms outside the frame range", () => {
    const frame = new Frame();
    const block = new Block();
    block.setColF("x", new Float64Array([0]));
    block.setColF("y", new Float64Array([0]));
    block.setColF("z", new Float64Array([0]));
    block.setColStr("element", ["H"]);
    frame.insertBlock("atoms", block);

    const atoms = new AtomSource();
    atoms.setFrame(frame);
    atoms.setEdit(5, {
      type: "atom",
      atomId: 5,
      element: "N",
      position: { x: 9, y: 8, z: 7 },
    });

    const points = fenceAtomWorldPoints(atoms);
    expect(points.map((p) => p.id).sort((a, b) => a - b)).toEqual([0, 5]);
    frame.free();
  });
});

describe("fenceBondWorldPoints", () => {
  it("uses bond midpoints from meta (frame or edit)", () => {
    const bonds = new BondSource();
    bonds.setEdit(0, {
      type: "bond",
      bondId: 0,
      atomId1: 0,
      atomId2: 1,
      bondType: 1,
      bondNumber: 1,
      start: { x: 0, y: 0, z: 0 },
      end: { x: 2, y: 4, z: 6 },
    });

    expect(fenceBondWorldPoints(bonds)).toEqual([{ id: 0, x: 1, y: 2, z: 3 }]);
  });
});

describe("selectIdsInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("selects atoms by projected screen position (identity project)", () => {
    const atoms = new AtomSource();
    atoms.setEdit(1, {
      type: "atom",
      atomId: 1,
      element: "C",
      position: { x: 5, y: 5, z: 0 },
    });
    atoms.setEdit(2, {
      type: "atom",
      atomId: 2,
      element: "O",
      position: { x: 50, y: 50, z: 0 },
    });

    const ids = selectIdsInPolygon(
      square,
      fenceAtomWorldPoints(atoms),
      (x, y) => ({ x, y }),
    );
    expect(ids).toEqual([1]);
  });
});
