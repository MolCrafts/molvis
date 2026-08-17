import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { ExpressionSelectionModifier } from "../../src/modifiers/ExpressionSelectionModifier";
import { createDefaultContext } from "../../src/pipeline/types";

describe("ExpressionSelectionModifier", () => {
  // Mock app
  const mockApp = {} as MolvisApp;

  test("Should support selection by element", () => {
    // Setup Frame
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1, 2]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["H", "C", "H"]);
    frame.insertBlock("atoms", atoms);

    // Context
    const context = createDefaultContext(frame, mockApp);

    // Modifier
    const modifier = new ExpressionSelectionModifier(
      "test-1",
      "element == 'C'",
    );

    // Validate
    expect(modifier.validate(frame, context).valid).toBe(true);

    // Apply
    modifier.apply(frame, context);

    // Check selection
    const selection = context.currentSelection;
    expect(selection.count()).toBe(1);
    expect(selection.isSelected(1)).toBe(true);
    expect(selection.isSelected(0)).toBe(false);
  });

  test("Should support coordinate expressions", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 10, -5]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["H", "H", "H"]);
    frame.insertBlock("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    const modifier = new ExpressionSelectionModifier("test-2", "x > 5");

    modifier.apply(frame, context);

    expect(context.currentSelection.isSelected(1)).toBe(true); // 10 > 5
    expect(context.currentSelection.isSelected(0)).toBe(false);
    expect(context.currentSelection.isSelected(2)).toBe(false);
  });

  test("Should handle invalid expressions gracefully during apply", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    atoms.setColStr("element", ["H"]);
    frame.insertBlock("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);

    // Empty expression should be VALID now
    const modifierEmpty = new ExpressionSelectionModifier("test-empty", "");
    expect(modifierEmpty.validate(frame, context).valid).toBe(true);
    // Apply should work (no selection)
    modifierEmpty.apply(frame, context);
    expect(context.currentSelection.count()).toBe(0);

    // Syntax error still invalid
    const modifierInvalid = new ExpressionSelectionModifier(
      "test-err",
      "element ==",
    );

    // Validate should catch it or apply should handle it?
    // In code, validate tries `new Function`.
    const validation = modifierInvalid.validate(frame, context);
    expect(validation.valid).toBe(false);
  });
});
