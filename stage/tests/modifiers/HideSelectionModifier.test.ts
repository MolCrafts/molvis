import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { HideSelectionModifier } from "../../src/modifiers/HideSelectionModifier";
import { createDefaultContext, SelectionMask } from "../../src/pipeline/types";

describe("HideSelectionModifier", () => {
  // Mock app
  const mockApp = {} as MolvisApp;

  test("Should pass through when selection is empty", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1, 2, 3, 4]));
    atoms.setColF("y", new Float64Array(5));
    atoms.setColF("z", new Float64Array(5));
    atoms.setColStr("element", ["C", "C", "H", "H", "O"]);
    frame.insertBlock("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.none(5);

    const modifier = new HideSelectionModifier();
    expect(modifier.validate(frame, context).valid).toBe(true);
    const out = modifier.apply(frame, context);
    expect(out.getBlock("atoms")?.nrows()).toBe(5);
  });

  test("Should hide selected atoms", () => {
    const frame = new Frame();
    const atoms = new Block();
    const count = 5;
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    const zs = new Float64Array(count);
    const elements = ["C", "C", "H", "H", "O"];

    for (let i = 0; i < count; i++) {
      xs[i] = i;
      ys[i] = 0;
      zs[i] = 0;
    }

    atoms.setColF("x", xs);
    atoms.setColF("y", ys);
    atoms.setColF("z", zs);
    atoms.setColStr("element", elements);
    frame.insertBlock("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    // Select indices 1 and 3 to hide
    context.currentSelection = SelectionMask.fromIndices(5, [1, 3]);

    const modifier = new HideSelectionModifier();
    const out = modifier.apply(frame, context);
    const outAtoms = out.getBlock("atoms")!;
    expect(outAtoms.nrows()).toBe(3);

    // Check remaining elements: 0(C), 2(H), 4(O)
    const outEls = outAtoms.copyColStr("element");
    expect(outEls).toEqual(["C", "H", "O"]);

    // Check xs: 0, 2, 4
    const outXs = outAtoms.viewColF("x");
    expect(outXs?.[0]).toBe(0);
    expect(outXs?.[1]).toBe(2);
    expect(outXs?.[2]).toBe(4);
  });

  test("Should remove bonds connected to hidden atoms", () => {
    const frame = new Frame();
    const atoms = new Block();
    // 0-1-2 chain
    atoms.setColF("x", new Float64Array([0, 1, 2]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["C", "C", "C"]);
    frame.insertBlock("atoms", atoms);

    const bonds = new Block();
    // Bonds: 0-1, 1-2
    bonds.setColU32("atomi", new Uint32Array([0, 1]));
    bonds.setColU32("atomj", new Uint32Array([1, 2]));
    bonds.setColU32("bond_type", new Uint32Array([1, 1]));
    bonds.setColU32("bond_number", new Uint32Array([1, 1]));
    frame.insertBlock("bonds", bonds);

    const context = createDefaultContext(frame, mockApp);
    // Hide atom 1 (middle)
    context.currentSelection = SelectionMask.fromIndices(3, [1]);

    const modifier = new HideSelectionModifier();
    const out = modifier.apply(frame, context);
    const outAtoms = out.getBlock("atoms")!;
    expect(outAtoms.nrows()).toBe(2); // 0 and 2 remain

    // Both bonds 0-1 and 1-2 connected to 1, so both should be removed.
    // A missing block counts as zero rows, but must not pass silently.
    expect(out.getBlock("bonds")?.nrows() ?? 0).toBe(0);
  });

  test("Should keep bonds between visible atoms", () => {
    const frame = new Frame();
    const atoms = new Block();
    // 0-1, 2 (isolated)
    atoms.setColF("x", new Float64Array([0, 1, 10]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["C", "C", "C"]);
    frame.insertBlock("atoms", atoms);

    const bonds = new Block();
    bonds.setColU32("atomi", new Uint32Array([0]));
    bonds.setColU32("atomj", new Uint32Array([1]));
    frame.insertBlock("bonds", bonds);

    const context = createDefaultContext(frame, mockApp);
    // Hide 2 (isolated)
    context.currentSelection = SelectionMask.fromIndices(3, [2]);

    const modifier = new HideSelectionModifier();
    const out = modifier.apply(frame, context);
    const outAtoms = out.getBlock("atoms")!;
    expect(outAtoms.nrows()).toBe(2); // 0, 1

    const outBonds = out.getBlock("bonds");
    expect(outBonds).toBeDefined();
    if (!outBonds) {
      throw new Error("Expected bonds block");
    }
    expect(outBonds.nrows()).toBe(1);

    // Bond 0-1 should refer to new indices 0 and 1 (since 0->0, 1->1, 2->hidden)
    const is = outBonds.viewColU32("atomi");
    if (!is) {
      throw new Error('Expected bonds column "atomi"');
    }
    const js = outBonds.viewColU32("atomj");
    if (!js) {
      throw new Error('Expected bonds column "atomj"');
    }
    expect(is[0]).toBe(0);
    expect(js[0]).toBe(1);
  });
});
