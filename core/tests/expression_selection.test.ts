import { beforeEach, describe, expect, test } from "@rstest/core";
import { SceneIndex } from "../src/scene_index";
import { SelectionManager } from "../src/selection_manager";

describe("Expression Selection", () => {
  let sceneIndex: SceneIndex;
  let selectionManager: SelectionManager;

  beforeEach(() => {
    sceneIndex = new SceneIndex();
    selectionManager = new SelectionManager(sceneIndex);
    // sceneIndex.metaRegistry.atoms.clear(); // Ensure clean state (Already new instance)

    // Setup mock data
    // We need to register a frame or add edits.
    // Let's use edits for simplicity as it doesn't require complex Block mocking if not needed,
    // but ExpressionSelector iterates sources.
    // SceneIndex.metaRegistry.atoms is an AtomSource.

    // Add 3 atoms
    // Atom 0: C at (0, 0, 0)
    sceneIndex.metaRegistry.atoms.setEdit(0, {
      type: "atom",
      atomId: 0,
      element: "C",
      position: { x: 0, y: 0, z: 0 },
    });

    // Atom 1: O at (10, 0, 0)
    sceneIndex.metaRegistry.atoms.setEdit(1, {
      type: "atom",
      atomId: 1,
      element: "O",
      position: { x: 10, y: 0, z: 0 },
    });

    // Atom 2: H at (5, 5, 0)
    sceneIndex.metaRegistry.atoms.setEdit(2, {
      type: "atom",
      atomId: 2,
      element: "H",
      position: { x: 5, y: 5, z: 0 },
    });

    // Expression selection returns logical atom ids directly; it does not need
    // render-time selection keys or a mesh registry.
  });

  test("Select by element", () => {
    selectionManager.selectByExpression("element == 'C'");
    const selected = selectionManager.getState().atoms;
    expect(selected.size).toBe(1);
    expect(selected.has(0)).toBe(true);
  });

  test("Select by coordinate >", () => {
    selectionManager.selectByExpression("x > 2");
    const selected = selectionManager.getState().atoms;
    expect(selected.size).toBe(2);
    expect(selected.has(1)).toBe(true);
    expect(selected.has(2)).toBe(true);
  });

  test("Select by combined logic", () => {
    selectionManager.selectByExpression("x > 2 && y < 2");
    const selected = selectionManager.getState().atoms;
    expect(selected.size).toBe(1);
    expect(selected.has(1)).toBe(true); // O is at (10, 0, 0) which is y=0 < 2
  });

  test("Select by ID", () => {
    selectionManager.selectByExpression("id == 2");
    const selected = selectionManager.getState().atoms;
    expect(selected.size).toBe(1);
    expect(selected.has(2)).toBe(true);
  });

  test("Select by Index (same as ID for now)", () => {
    selectionManager.selectByExpression("index == 0");
    const selected = selectionManager.getState().atoms;
    expect(selected.size).toBe(1);
    expect(selected.has(0)).toBe(true);
  });

  test("Add to selection", () => {
    selectionManager.selectByExpression("element == 'C'");
    selectionManager.selectByExpression("element == 'O'", "add");
    const selected = selectionManager.getState().atoms;
    expect(selected.size).toBe(2);
    expect(selected.has(0)).toBe(true);
    expect(selected.has(1)).toBe(true);
  });

  test("Safe evaluation prevents crash on error", () => {
    // This might span console.error, ideally we suppress it or verify it handles gracefully
    // "foo" is not defined
    selectionManager.selectByExpression("foo == 1");
    const selected = selectionManager.getState().atoms;
    expect(selected.size).toBe(0);
  });
});
