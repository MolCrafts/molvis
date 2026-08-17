import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { EditTypesModifier } from "../../src/modifiers/EditTypesModifier";
import { createDefaultContext, SelectionMask } from "../../src/pipeline/types";

describe("EditTypesModifier", () => {
  test("sets element on selection only", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1, 2]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["H", "C", "H"]);
    frame.insertBlock("atoms", atoms);
    const ctx = createDefaultContext(frame, {} as MolvisApp);
    ctx.currentSelection = SelectionMask.fromIndices(3, [1]);
    const mod = new EditTypesModifier();
    mod.setElement("N");
    const out = mod.apply(frame, ctx);
    const els = out.getBlock("atoms")?.copyColStr("element") as string[];
    expect(els[0]).toBe("H");
    expect(els[1]).toBe("N");
    expect(els[2]).toBe("H");
  });
});
