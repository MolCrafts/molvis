import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { SelectTypeModifier } from "../../src/modifiers/SelectTypeModifier";
import { createDefaultContext } from "../../src/pipeline/types";

function hchFrame(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0, 1, 2]));
  atoms.setColF("y", new Float64Array([0, 0, 0]));
  atoms.setColF("z", new Float64Array([0, 0, 0]));
  atoms.setColStr("element", ["H", "C", "H"]);
  frame.insertBlock("atoms", atoms);
  return frame;
}

describe("SelectTypeModifier", () => {
  const mockApp = {} as MolvisApp;

  test("elements ['C'] on H-C-H selects only index 1", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    const mod = new SelectTypeModifier("st");
    mod.elements = ["C"];
    mod.apply(frame, context);
    expect(context.currentSelection.count()).toBe(1);
    expect(context.currentSelection.isSelected(1)).toBe(true);
    expect(context.currentSelection.isSelected(0)).toBe(false);
  });

  test("types match a stringified numeric type_id column", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1, 2]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["H", "C", "H"]);
    // LAMMPS ordinals live in `type_id` (UInt); `type` is reserved for the
    // String force-field label.
    atoms.setColU32("type_id", new Uint32Array([1, 2, 1]));
    frame.insertBlock("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    const mod = new SelectTypeModifier();
    mod.types = ["2"];
    mod.apply(frame, context);
    expect(context.currentSelection.count()).toBe(1);
    expect(context.currentSelection.isSelected(1)).toBe(true);
  });

  test("types match a String type label column", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1, 2]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["H", "C", "H"]);
    atoms.setColStr("type", ["HA", "CT", "HA"]);
    frame.insertBlock("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    const mod = new SelectTypeModifier();
    mod.types = ["CT"];
    mod.apply(frame, context);
    expect(context.currentSelection.count()).toBe(1);
    expect(context.currentSelection.isSelected(1)).toBe(true);
  });

  test("elements and types union", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1, 2]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["H", "C", "O"]);
    atoms.setColU32("type_id", new Uint32Array([1, 2, 3]));
    frame.insertBlock("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    const mod = new SelectTypeModifier();
    mod.elements = ["H"];
    mod.types = ["3"];
    mod.apply(frame, context);
    // H at 0, O via type 3 at 2
    expect(context.currentSelection.isSelected(0)).toBe(true);
    expect(context.currentSelection.isSelected(1)).toBe(false);
    expect(context.currentSelection.isSelected(2)).toBe(true);
    expect(context.currentSelection.count()).toBe(2);
  });

  test("empty elements and types selects none", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    new SelectTypeModifier().apply(frame, context);
    expect(context.currentSelection.count()).toBe(0);
    expect(context.currentSelection.isEmpty()).toBe(true);
  });
});
