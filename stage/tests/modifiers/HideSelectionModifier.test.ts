import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import type { MolvisApp } from "../../src/app";
import { HideSelectionModifier } from "../../src/modifiers/HideSelectionModifier";
import { createDefaultContext, SelectionMask } from "../../src/pipeline/types";

describe("HideSelectionModifier", () => {
  // Mock app
  const mockApp = {} as MolvisApp;

  test("Should pass through when selection is empty", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0, 1, 2, 3, 4]));
    atoms.set("y", new Float64Array(5));
    atoms.set("z", new Float64Array(5));
    atoms.set("element", ["C", "C", "H", "H", "O"]);
    frame.set("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.none(5);

    const modifier = new HideSelectionModifier();
    expect(modifier.validate(frame, context).valid).toBe(true);
    const out = modifier.apply(frame, context);
    expect(out.get("atoms").nRows).toBe(5);
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

    atoms.set("x", xs);
    atoms.set("y", ys);
    atoms.set("z", zs);
    atoms.set("element", elements);
    frame.set("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    // Select indices 1 and 3 to hide
    context.currentSelection = SelectionMask.fromIndices(5, [1, 3]);

    const modifier = new HideSelectionModifier();
    const out = modifier.apply(frame, context);
    const outAtoms = out.get("atoms");
    expect(outAtoms.nRows).toBe(3);

    // Check remaining elements: 0(C), 2(H), 4(O)
    const outEls = outAtoms.copy("element") as string[];
    expect([...outEls]).toEqual(["C", "H", "O"]);

    // Check xs: 0, 2, 4
    const outXs = outAtoms.view("x") as Float64Array;
    expect(outXs?.[0]).toBe(0);
    expect(outXs?.[1]).toBe(2);
    expect(outXs?.[2]).toBe(4);
  });

  test("Should remove bonds connected to hidden atoms", () => {
    const frame = new Frame();
    const atoms = new Block();
    // 0-1-2 chain
    atoms.set("x", new Float64Array([0, 1, 2]));
    atoms.set("y", new Float64Array([0, 0, 0]));
    atoms.set("z", new Float64Array([0, 0, 0]));
    atoms.set("element", ["C", "C", "C"]);
    frame.set("atoms", atoms);

    const bonds = new Block();
    // Bonds: 0-1, 1-2
    bonds.set("atomi", toDomainUint([0, 1]));
    bonds.set("atomj", toDomainUint([1, 2]));
    bonds.set("bond_type", toDomainUint([1, 1]));
    bonds.set("bond_number", toDomainUint([1, 1]));
    frame.set("bonds", bonds);

    const context = createDefaultContext(frame, mockApp);
    // Hide atom 1 (middle)
    context.currentSelection = SelectionMask.fromIndices(3, [1]);

    const modifier = new HideSelectionModifier();
    const out = modifier.apply(frame, context);
    const outAtoms = out.get("atoms");
    expect(outAtoms.nRows).toBe(2); // 0 and 2 remain

    // Both bonds 0-1 and 1-2 connected to 1, so both should be removed.
    // A missing block counts as zero rows, but must not pass silently.
    expect(out.has("bonds") ? out.get("bonds").nRows : 0).toBe(0);
  });

  test("Should keep bonds between visible atoms", () => {
    const frame = new Frame();
    const atoms = new Block();
    // 0-1, 2 (isolated)
    atoms.set("x", new Float64Array([0, 1, 10]));
    atoms.set("y", new Float64Array([0, 0, 0]));
    atoms.set("z", new Float64Array([0, 0, 0]));
    atoms.set("element", ["C", "C", "C"]);
    frame.set("atoms", atoms);

    const bonds = new Block();
    bonds.set("atomi", toDomainUint([0]));
    bonds.set("atomj", toDomainUint([1]));
    frame.set("bonds", bonds);

    const context = createDefaultContext(frame, mockApp);
    // Hide 2 (isolated)
    context.currentSelection = SelectionMask.fromIndices(3, [2]);

    const modifier = new HideSelectionModifier();
    const out = modifier.apply(frame, context);
    const outAtoms = out.get("atoms");
    expect(outAtoms.nRows).toBe(2); // 0, 1

    const outBonds = out.has("bonds") ? out.get("bonds") : undefined;
    expect(outBonds).toBeDefined();
    if (!outBonds) {
      throw new Error("Expected bonds block");
    }
    expect(outBonds.nRows).toBe(1);

    // Bond 0-1 should refer to new indices 0 and 1 (since 0->0, 1->1, 2->hidden)
    const is = outBonds.view("atomi") as BigUint64Array;
    if (!is) {
      throw new Error('Expected bonds column "atomi"');
    }
    const js = outBonds.view("atomj") as BigUint64Array;
    if (!js) {
      throw new Error('Expected bonds column "atomj"');
    }
    expect(Number(is[0])).toBe(0);
    expect(Number(js[0])).toBe(1);
  });

  test("Should preserve non-coordinate columns (including the molrs id column)", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0, 1, 2]));
    atoms.set("y", new Float64Array([0, 0, 0]));
    atoms.set("z", new Float64Array([0, 0, 0]));
    atoms.set("element", ["C", "O", "N"]);
    atoms.set("id", toDomainUint([10, 20, 30]));
    frame.set("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    context.currentSelection = SelectionMask.fromIndices(3, [1]);

    const out = new HideSelectionModifier().apply(frame, context);
    const outAtoms = out.get("atoms");
    expect(outAtoms.nRows).toBe(2);

    const ids = outAtoms.copy("id") as BigUint64Array;
    expect(Array.from(ids, Number)).toEqual([10, 30]);
  });
});
