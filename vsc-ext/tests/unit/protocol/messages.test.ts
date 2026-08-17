import * as assert from "assert";
import {
  isQuickViewHostMessage,
  isWorkbenchHostMessage,
  QUICK_VIEW_HOST_MESSAGE_TYPES,
  WORKBENCH_HOST_MESSAGE_TYPES,
} from "../../../src/protocol";

suite("protocol/messages", () => {
  test("QUICK_VIEW_HOST_MESSAGE_TYPES lists the core set", () => {
    assert.deepStrictEqual([...QUICK_VIEW_HOST_MESSAGE_TYPES].sort(), [
      "applySettings",
      "error",
      "init",
      "loadFile",
      "triggerSave",
    ]);
  });

  test("isQuickViewHostMessage accepts loadFile with stream", () => {
    const msg = {
      type: "loadFile",
      content: new Uint8Array([1, 2, 3]),
      filename: "traj.lammpstrj",
      format: "lammps-dump",
      stream: true,
    };
    assert.strictEqual(isQuickViewHostMessage(msg), true);
  });

  test("isQuickViewHostMessage rejects selectAtoms (Workbench-only)", () => {
    assert.strictEqual(
      isQuickViewHostMessage({ type: "selectAtoms", indices: [0] }),
      false,
    );
  });

  test("isWorkbenchHostMessage accepts selectAtoms, capabilities, surface", () => {
    assert.strictEqual(
      isWorkbenchHostMessage({ type: "selectAtoms", indices: [0] }),
      true,
    );
    assert.strictEqual(
      isWorkbenchHostMessage({ type: "enableCapability", id: "outline" }),
      true,
    );
    assert.strictEqual(
      isWorkbenchHostMessage({
        type: "setWorkbenchSurface",
        surface: "sketch",
      }),
      true,
    );
    assert.ok(WORKBENCH_HOST_MESSAGE_TYPES.includes("selectAtoms"));
  });

  test("isQuickViewHostMessage rejects enableCapability (Workbench-only)", () => {
    assert.strictEqual(
      isQuickViewHostMessage({ type: "enableCapability", id: "pipeline" }),
      false,
    );
  });

  test("isQuickViewHostMessage rejects non-objects", () => {
    assert.strictEqual(isQuickViewHostMessage(null), false);
    assert.strictEqual(isQuickViewHostMessage("init"), false);
    assert.strictEqual(isQuickViewHostMessage({}), false);
  });
});
