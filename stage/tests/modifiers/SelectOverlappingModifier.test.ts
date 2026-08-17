import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { SelectOverlappingModifier } from "../../src/modifiers/SelectOverlappingModifier";
import { createDefaultContext } from "../../src/pipeline/types";

describe("SelectOverlappingModifier", () => {
  test("selects close pair, not distant atom", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 0.2, 5]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["C", "C", "C"]);
    frame.insertBlock("atoms", atoms);
    frame.box = Box.cube(20, new Float64Array([0, 0, 0]), true, true, true);
    const ctx = createDefaultContext(frame, {} as MolvisApp);
    const mod = new SelectOverlappingModifier();
    mod.setCutoff(0.5);
    mod.apply(frame, ctx);
    expect(ctx.currentSelection.isSelected(0)).toBe(true);
    expect(ctx.currentSelection.isSelected(1)).toBe(true);
    expect(ctx.currentSelection.isSelected(2)).toBe(false);
  });
});
