import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import {
  ClearSelectionModifier,
  SelectModifier,
} from "../../src/modifiers/SelectModifier";
import { createDefaultContext, SelectionMask } from "../../src/pipeline/types";

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

describe("SelectModifier", () => {
  const mockApp = {} as MolvisApp;

  test("expression element == 'C' selects only carbon", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    const modifier = new SelectModifier("sel", "element == 'C'");

    expect(modifier.validate(frame, context).valid).toBe(true);
    modifier.apply(frame, context);

    expect(context.currentSelection.count()).toBe(1);
    expect(context.currentSelection.isSelected(1)).toBe(true);
    expect(context.currentSelection.isSelected(0)).toBe(false);
    expect(context.currentSelection.isSelected(2)).toBe(false);
  });

  test("coordinate expression x > 5", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 10, -5]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["H", "H", "H"]);
    frame.insertBlock("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    new SelectModifier("sel", "x > 5").apply(frame, context);

    expect(context.currentSelection.isSelected(1)).toBe(true);
    expect(context.currentSelection.isSelected(0)).toBe(false);
    expect(context.currentSelection.isSelected(2)).toBe(false);
  });

  test("empty expression selects nothing", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    new SelectModifier("sel", "   ").apply(frame, context);
    expect(context.currentSelection.count()).toBe(0);
  });

  test("invalid expression fails validate", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    const modifier = new SelectModifier("sel", "element ==");
    const result = modifier.validate(frame, context);
    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  test("invalid expression apply does not select-all", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    // Leave current selection at all; bad apply must not expand to all via string path
    context.currentSelection = SelectionMask.all(3);
    const modifier = new SelectModifier("sel", "element ==");
    // Even if validate would fail, apply must not silently select-all
    modifier.apply(frame, context);
    // Best-effort: either empty or previous — never force all from bad expr.
    // Implementation: treat uncompilable like empty → nothing selected.
    expect(context.currentSelection.count()).toBe(0);
  });

  test("number[] path still works", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    new SelectModifier("sel", [0, 2]).apply(frame, context);
    expect(context.currentSelection.count()).toBe(2);
    expect(context.currentSelection.isSelected(0)).toBe(true);
    expect(context.currentSelection.isSelected(2)).toBe(true);
  });

  test("mode add unions with current selection", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.fromIndices(3, [0]);
    new SelectModifier("sel", "element == 'C'", "add").apply(frame, context);
    expect(context.currentSelection.isSelected(0)).toBe(true);
    expect(context.currentSelection.isSelected(1)).toBe(true);
    expect(context.currentSelection.isSelected(2)).toBe(false);
  });

  test("mode remove subtracts expression matches", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.all(3);
    new SelectModifier("sel", "element == 'H'", "remove").apply(frame, context);
    expect(context.currentSelection.count()).toBe(1);
    expect(context.currentSelection.isSelected(1)).toBe(true);
  });
});

describe("ClearSelectionModifier", () => {
  const mockApp = {} as MolvisApp;

  test("writes empty mask not all (OVITO clear)", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.all(3);
    context.selectedBondIds = [0, 1];

    new ClearSelectionModifier("clear").apply(frame, context);

    expect(context.currentSelection.count()).toBe(0);
    expect(context.currentSelection.isEmpty()).toBe(true);
    expect(context.currentSelection.isAll()).toBe(false);
    expect(context.selectedBondIds).toEqual([]);
    expect(context.selectionSet.get("clear")?.isEmpty()).toBe(true);
  });

  test("clears a partial selection to empty", () => {
    const frame = hchFrame();
    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.fromIndices(3, [0, 2]);
    new ClearSelectionModifier().apply(frame, context);
    expect(context.currentSelection.count()).toBe(0);
  });
});
