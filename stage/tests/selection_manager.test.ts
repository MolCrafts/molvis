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
});
