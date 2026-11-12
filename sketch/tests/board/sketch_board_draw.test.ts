import { describe, expect, it } from "@rstest/core";
import { SketchBoard } from "../../src/board/sketch_board";

describe("SketchBoard draw verbs", () => {
  it("drawAtom returns the new index and undo removes it", () => {
    const board = new SketchBoard();
    const index = board.drawAtom({ element: "O", x: 1, y: 2, charge: 0 });
    expect(index).toBe(0);
    expect(board.getMoleculeData().atoms[0]).toMatchObject({
      element: "O",
      x: 1,
      y: 2,
    });
    board.undo();
    expect(board.getMoleculeData()).toEqual({ atoms: [], bonds: [] });
  });

  it("drawBond connects two drawn atoms and undo removes the bond", () => {
    const board = new SketchBoard();
    const i = board.drawAtom({ element: "C", x: 0, y: 0 });
    const j = board.drawAtom({ element: "C", x: 1, y: 0 });
    const bond = board.drawBond({ i, j, order: 2, stereo: "none" });
    expect(bond).toBe(0);
    expect(board.getMoleculeData().bonds).toEqual([
      { i: 0, j: 1, order: 2, stereo: "none" },
    ]);
    board.undo();
    expect(board.getMoleculeData().bonds).toEqual([]);
  });

  it("drawChain places carbon bonds of order 1 and ignores the toolbar bond order", () => {
    const board = new SketchBoard({ bondChainStep: 1 });
    board.setBondOrder(2);
    board.drawChain(0, 0, 3, 0);
    const data = board.getMoleculeData();
    expect(data.atoms.length).toBeGreaterThan(1);
    expect(data.atoms.every((atom) => atom.element === "C")).toBe(true);
    expect(data.bonds.every((bond) => bond.order === 1)).toBe(true);
    expect(data.atoms.every((atom) => atom.color === undefined)).toBe(true);
    expect(data.bonds.every((bond) => bond.color === undefined)).toBe(true);
    board.undo();
    expect(board.getMoleculeData()).toEqual({ atoms: [], bonds: [] });
  });

  it("drawChain from a start atom ignores x0 and y0", () => {
    const board = new SketchBoard({ bondChainStep: 1 });
    const start = board.drawAtom({ element: "N", x: 0, y: 0 });
    board.drawChain(99, 99, 3, 0, start);
    const data = board.getMoleculeData();
    expect(data.atoms[0]).toMatchObject({ element: "N", x: 0, y: 0 });
    expect(data.atoms.slice(1).every((atom) => atom.element === "C")).toBe(
      true,
    );
    expect(data.bonds.every((bond) => bond.order === 1)).toBe(true);
  });

  it("deleteSelection removes the selected atom as one undo step", () => {
    const board = new SketchBoard();
    board.drawAtom({ element: "C", x: 0, y: 0 });
    board.drawAtom({ element: "O", x: 1, y: 0 });
    board.replaceSelectedAtoms([1]);
    board.deleteSelection();
    expect(board.getMoleculeData().atoms).toEqual([
      { element: "C", x: 0, y: 0 },
    ]);
    expect(board.selectedAtomIndices()).toEqual([]);
    board.undo();
    expect(board.getMoleculeData().atoms).toHaveLength(2);
  });
});
