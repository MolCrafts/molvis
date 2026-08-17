import { CommandManager } from "@molcrafts/molvis-core/command";
import { describe, expect, it } from "@rstest/core";
import * as sketch from "../src/index";

/**
 * `sketch` carried its own undo/redo stack because core's was welded to the
 * 3D app — its comment read "Semantics mirror core CommandManager (execute
 * clears redo) without importing core". The weld is gone, so the copy is too.
 *
 * These fail if one grows back: a second stack is a place for the semantics
 * core asserts to drift out from under this package.
 */
describe("sketch keeps no history of its own", () => {
  it("no longer exports a local history", () => {
    expect(Object.keys(sketch)).not.toContain("SketchHistory");
  });

  it("drives reversible edits through core's manager, synchronously", () => {
    // The board applies edits inside a pointer handler and reads canUndo() in
    // the same tick, so a synchronous command must not be deferred.
    const history = new CommandManager({ events: { emit: () => {} } });
    let state = 0;
    const command = {
      do: () => {
        state += 1;
      },
      undo: () => {
        state -= 1;
      },
    };
    history.execute(command);
    expect(state).toBe(1);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(state).toBe(0);
    expect(history.canRedo()).toBe(true);
  });
});
