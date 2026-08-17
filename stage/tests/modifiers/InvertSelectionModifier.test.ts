import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { InvertSelectionModifier } from "../../src/modifiers/InvertSelectionModifier";
import { ModifierCapability } from "../../src/pipeline/modifier";
import { createDefaultContext, SelectionMask } from "../../src/pipeline/types";

function threeAtomFrame(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0, 1, 2]));
  atoms.setColF("y", new Float64Array([0, 0, 0]));
  atoms.setColF("z", new Float64Array([0, 0, 0]));
  atoms.setColStr("element", ["H", "C", "H"]);
  frame.insertBlock("atoms", atoms);
  return frame;
}

describe("InvertSelectionModifier", () => {
  const mockApp = {} as MolvisApp;

  test("declares ConsumesSelection and ProducesSelection", () => {
    const mod = new InvertSelectionModifier();
    expect(mod.capabilities.has(ModifierCapability.ConsumesSelection)).toBe(
      true,
    );
    expect(mod.capabilities.has(ModifierCapability.ProducesSelection)).toBe(
      true,
    );
  });

  test("fromIndices([0,2]) inverts to only index 1", () => {
    const frame = threeAtomFrame();
    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.fromIndices(3, [0, 2]);

    new InvertSelectionModifier("inv").apply(frame, context);

    expect(context.currentSelection.count()).toBe(1);
    expect(context.currentSelection.isSelected(0)).toBe(false);
    expect(context.currentSelection.isSelected(1)).toBe(true);
    expect(context.currentSelection.isSelected(2)).toBe(false);
    expect(context.selectionSet.get("inv")?.isSelected(1)).toBe(true);
  });

  test("all inverts to none", () => {
    const frame = threeAtomFrame();
    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.all(3);
    new InvertSelectionModifier().apply(frame, context);
    expect(context.currentSelection.isEmpty()).toBe(true);
  });

  test("none inverts to all", () => {
    const frame = threeAtomFrame();
    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.none(3);
    new InvertSelectionModifier().apply(frame, context);
    expect(context.currentSelection.isAll()).toBe(true);
  });
});
