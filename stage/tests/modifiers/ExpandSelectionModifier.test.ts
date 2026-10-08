import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import type { MolvisApp } from "../../src/app";
import { ExpandSelectionModifier } from "../../src/modifiers/ExpandSelectionModifier";
import { ModifierCapability } from "../../src/pipeline/modifier";
import { createDefaultContext, SelectionMask } from "../../src/pipeline/types";

/** Linear H–C–H with bonds 0–1 and 1–2. */
function linearMolecule(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array([0, 1.1, 2.2]));
  atoms.set("y", new Float64Array([0, 0, 0]));
  atoms.set("z", new Float64Array([0, 0, 0]));
  atoms.set("element", ["H", "C", "H"]);
  frame.set("atoms", atoms);

  const bonds = new Block();
  bonds.set("atomi", toDomainUint([0, 1]));
  bonds.set("atomj", toDomainUint([1, 2]));
  frame.set("bonds", bonds);
  return frame;
}

describe("ExpandSelectionModifier", () => {
  const mockApp = {} as MolvisApp;

  test("declares ConsumesSelection and ProducesSelection", () => {
    const mod = new ExpandSelectionModifier();
    expect(mod.capabilities.has(ModifierCapability.ConsumesSelection)).toBe(
      true,
    );
    expect(mod.capabilities.has(ModifierCapability.ProducesSelection)).toBe(
      true,
    );
  });

  test("bonds mode 1-hop expands [0] to {0,1}", () => {
    const frame = linearMolecule();
    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.fromIndices(3, [0]);

    const mod = new ExpandSelectionModifier();
    mod.mode = "bonds";
    mod.apply(frame, context);

    expect(context.currentSelection.isSelected(0)).toBe(true);
    expect(context.currentSelection.isSelected(1)).toBe(true);
    expect(context.currentSelection.isSelected(2)).toBe(false);
    expect(context.currentSelection.count()).toBe(2);
  });

  test("cutoff mode expands center to neighbors", () => {
    const frame = linearMolecule();
    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.fromIndices(3, [1]);

    const mod = new ExpandSelectionModifier();
    mod.mode = "cutoff";
    mod.cutoff = 1.5; // 1.1 Å neighbor distance
    mod.apply(frame, context);

    expect(context.currentSelection.isSelected(0)).toBe(true);
    expect(context.currentSelection.isSelected(1)).toBe(true);
    expect(context.currentSelection.isSelected(2)).toBe(true);
    expect(context.currentSelection.count()).toBe(3);
  });

  test("bonds mode without bonds keeps original selection", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0, 1, 2]));
    atoms.set("y", new Float64Array([0, 0, 0]));
    atoms.set("z", new Float64Array([0, 0, 0]));
    atoms.set("element", ["H", "C", "H"]);
    frame.set("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.fromIndices(3, [0]);
    const mod = new ExpandSelectionModifier();
    mod.mode = "bonds";
    mod.apply(frame, context);
    expect(context.currentSelection.count()).toBe(1);
    expect(context.currentSelection.isSelected(0)).toBe(true);
  });

  test("empty selection stays empty", () => {
    const frame = linearMolecule();
    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.none(3);
    const mod = new ExpandSelectionModifier();
    mod.mode = "both";
    mod.apply(frame, context);
    expect(context.currentSelection.isEmpty()).toBe(true);
  });
});
