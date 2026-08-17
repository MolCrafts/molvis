import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { getSelectedCommand } from "../../src/commands/selection";
import { AtomSource, BondSource } from "../../src/entity_source";
import type { SceneIndex } from "../../src/scene_index";
import { SelectionManager } from "../../src/selection_manager";

function mockSceneIndex(atoms: AtomSource, bonds: BondSource): SceneIndex {
  return {
    metaRegistry: { atoms, bonds },
    hasUnsavedChanges: atoms.edits.size > 0 || bonds.edits.size > 0,
    markAllSaved() {},
  } as unknown as SceneIndex;
}

describe("getSelectedCommand", () => {
  it("materializes dirty edit-pool selection with canvas coordinates", () => {
    const atoms = new AtomSource();
    atoms.setEdit(10, {
      type: "atom",
      atomId: 10,
      element: "C",
      position: { x: 1.5, y: 2.5, z: 3.5 },
    });
    atoms.setEdit(11, {
      type: "atom",
      atomId: 11,
      element: "O",
      position: { x: 4, y: 5, z: 6 },
    });
    const bonds = new BondSource();
    bonds.setEdit(0, {
      type: "bond",
      bondId: 0,
      atomId1: 10,
      atomId2: 11,
      bondType: 1,
      bondNumber: 1,
      start: { x: 1.5, y: 2.5, z: 3.5 },
      end: { x: 4, y: 5, z: 6 },
    });

    const sceneIndex = mockSceneIndex(atoms, bonds);
    const sm = new SelectionManager(sceneIndex);
    sm.apply({ type: "replace", atoms: [10, 11], bonds: [0] });

    // Stale HEAD with wrong coords — must not win while dirty.
    const head = new Frame();
    const headAtoms = new Block();
    headAtoms.setColF("x", new Float64Array([0, 0]));
    headAtoms.setColF("y", new Float64Array([0, 0]));
    headAtoms.setColF("z", new Float64Array([0, 0]));
    headAtoms.setColStr("element", ["C", "O"]);
    head.insertBlock("atoms", headAtoms);

    const app = {
      frame: head,
      world: { sceneIndex, selectionManager: sm },
    } as unknown as MolvisApp;

    const { frame } = getSelectedCommand(app);
    const out = frame.getBlock("atoms");
    expect(out?.nrows()).toBe(2);
    expect(Array.from(out!.viewColF("x")!)).toEqual([1.5, 4]);
    expect(Array.from(out!.viewColF("y")!)).toEqual([2.5, 5]);
    expect(Array.from(out!.viewColF("z")!)).toEqual([3.5, 6]);
    frame.free();
    head.free();
  });

  it("throws when a selected id is not on the canvas", () => {
    const atoms = new AtomSource();
    atoms.setEdit(0, {
      type: "atom",
      atomId: 0,
      element: "H",
      position: { x: 0, y: 0, z: 0 },
    });
    const sceneIndex = mockSceneIndex(atoms, new BondSource());
    const sm = new SelectionManager(sceneIndex);
    // Id 99 was never registered on SceneIndex.
    sm.apply({ type: "replace", atoms: [0, 99] });

    const app = {
      frame: null,
      world: { sceneIndex, selectionManager: sm },
    } as unknown as MolvisApp;

    expect(() => getSelectedCommand(app)).toThrow(/not on the canvas/);
  });
});
