import { beforeEach, describe, expect, test } from "@rstest/core";
import { SceneIndex } from "../src/scene_index";
import { SelectionManager } from "../src/selection_manager";

describe("SelectionManager expression context", () => {
  let sceneIndex: SceneIndex;
  let selectionManager: SelectionManager;

  beforeEach(() => {
    sceneIndex = new SceneIndex();
    selectionManager = new SelectionManager(sceneIndex);

    sceneIndex.metaRegistry.atoms.setEdit(0, {
      type: "atom",
      atomId: 0,
      element: "C",
      position: { x: 0, y: 0, z: 0 },
    });
    sceneIndex.metaRegistry.atoms.setEdit(1, {
      type: "atom",
      atomId: 1,
      element: "O",
      position: { x: 1, y: 0, z: 0 },
    });

    // Expression selection stores logical atom ids, independent of render keys.
  });

  test("tracks expression selection context", () => {
    selectionManager.selectByExpression("element == 'C'");

    expect(selectionManager.hasExpressionSelectionContext()).toBe(true);
    expect(selectionManager.getState().atoms.has(0)).toBe(true);
  });

  test("manual apply clears expression context", () => {
    selectionManager.selectByExpression("element == 'C'");
    selectionManager.apply({ type: "replace", atoms: [1] });

    expect(selectionManager.hasExpressionSelectionContext()).toBe(false);
  });

  test("can reapply latest expression", () => {
    selectionManager.selectByExpression("element == 'C'");
    selectionManager.apply({ type: "replace", atoms: [1] });
    const ok = selectionManager.reapplyLastExpression();

    expect(ok).toBe(true);
    expect(selectionManager.getState().atoms.has(0)).toBe(true);
    expect(selectionManager.getState().atoms.has(1)).toBe(false);
  });
});
