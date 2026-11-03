import { describe, expect, it } from "@rstest/core";
import { SelectionManager } from "../src/selection_manager";

function sceneIndex() {
  return {
    getMeta: (_meshId: number, subIndex?: number) => {
      if (subIndex === 0) return { type: "atom" as const, atomId: 10 };
      if (subIndex === 1) return { type: "bond" as const, bondId: 20 };
      return null;
    },
    getSelectionKeyForAtom: (atomId: number) =>
      atomId === 10 ? "1:0" : undefined,
    getSelectionKeysForBond: (bondId: number) => (bondId === 20 ? ["1:1"] : []),
  } as never;
}

describe("SelectionManager logical id storage", () => {
  it("stores atom and bond selections as numeric ids", () => {
    const manager = new SelectionManager(sceneIndex());
    manager.apply({ type: "replace", atoms: [10], bonds: [20] });

    const state = manager.getState();
    expect([...state.atoms]).toEqual([10]);
    expect([...state.bonds]).toEqual([20]);
    expect(manager.isSelected(10, "atom")).toBe(true);
    expect(manager.isSelected(20, "bond")).toBe(true);
  });

  it("accepts render keys at the boundary and converts them once", () => {
    const manager = new SelectionManager(sceneIndex());
    manager.apply({ type: "replace", atoms: ["1:0"], bonds: ["1:1"] });

    const state = manager.getState();
    expect([...state.atoms]).toEqual([10]);
    expect([...state.bonds]).toEqual([20]);
  });

  it("increments revision on every emitted change", () => {
    const manager = new SelectionManager(sceneIndex());
    const revisions: number[] = [];
    manager.on("selection-change", (state) => revisions.push(state.revision));

    manager.apply({ type: "replace", atoms: [10] });
    manager.apply({ type: "clear" });

    expect(revisions).toEqual([1, 2]);
  });

  it("carries a highlight color override and resets it on clear", () => {
    const manager = new SelectionManager(sceneIndex());
    manager.setHighlightColor("#FF0000");
    manager.apply({ type: "replace", atoms: [10] });

    expect(manager.getState().highlightColor).toBe("#FF0000");

    manager.apply({ type: "clear" });
    expect(manager.getState().highlightColor).toBeNull();
  });
});

describe("SelectionManager.getSelectedMeta", () => {
  it("exports logical IDs reached through nonidentity render keys", () => {
    const atom = {
      type: "atom",
      atomId: 20,
      element: "O",
      position: { x: 2, y: 3, z: 4 },
    };
    const bond = {
      type: "bond",
      bondId: 1,
      atomId1: 20,
      atomId2: 21,
      bondType: 2,
      bondNumber: 2,
      start: { x: 2, y: 3, z: 4 },
      end: { x: 3, y: 4, z: 5 },
    };
    const manager = new SelectionManager({
      getSelectionKeyForAtom: (id: number) => (id === 20 ? "7:0" : null),
      getSelectionKeysForBond: (id: number) => (id === 1 ? ["8:2", "8:3"] : []),
      getMeta: (mesh: number, slot: number) =>
        mesh === 7 && slot === 0
          ? atom
          : mesh === 8 && (slot === 2 || slot === 3)
            ? bond
            : null,
    } as never);
    manager.apply({ type: "replace", atoms: [20, 99], bonds: [1, 99] });
    const result = manager.getSelectedMeta();
    expect(result.atoms.atomId).toEqual([20]);
    expect(result.atoms.x).toEqual([2]);
    expect(result.bonds.bondId).toEqual([1]);
    expect(result.bonds.atomId1).toEqual([20]);
    expect(result.bonds.order).toEqual([2]);
  });
});
