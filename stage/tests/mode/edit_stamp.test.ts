import type { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../../src/app";
import { EditMode } from "../../src/mode/edit";
import { stageEditMolecule } from "../../src/mode/edit_stamp";

function frameStub(): Frame & { freed: boolean } {
  const frame = {
    freed: false,
    free() {
      frame.freed = true;
    },
  };
  return frame as Frame & { freed: boolean };
}

describe("stageEditMolecule", () => {
  it("frees the frame when Edit mode is not active", () => {
    const frame = frameStub();
    const app = { mode: { name: "view" } } as unknown as MolvisApp;
    expect(() => stageEditMolecule(app, frame)).toThrow(/Edit mode/);
    expect(frame.freed).toBe(true);
  });

  it("arms Edit mode with the frame", () => {
    const frame = frameStub();
    const mode = Object.create(EditMode.prototype) as EditMode;
    const app = { mode } as unknown as MolvisApp;
    stageEditMolecule(app, frame);
    expect(mode.pendingMolecule).toBe(frame);
    expect(frame.freed).toBe(false);
  });
});
