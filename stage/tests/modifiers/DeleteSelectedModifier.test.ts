import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import type { MolvisApp } from "../../src/app";
import { DeleteSelectedModifier } from "../../src/modifiers/DeleteSelectedModifier";
import { createDefaultContext, SelectionMask } from "../../src/pipeline/types";

function makeFrame(elements: string[], bonds?: [number, number][]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array(elements.map((_, i) => i)));
  atoms.set("y", new Float64Array(elements.length));
  atoms.set("z", new Float64Array(elements.length));
  atoms.set("element", elements);
  frame.set("atoms", atoms);

  if (bonds) {
    const bondsBlock = new Block();
    bondsBlock.set("atomi", toDomainUint(bonds.map((b) => b[0])));
    bondsBlock.set("atomj", toDomainUint(bonds.map((b) => b[1])));
    frame.set("bonds", bondsBlock);
  }

  return frame;
}

describe("DeleteSelectedModifier", () => {
  // The modifier never reads `context.app`; the seam only has to exist.
  const mockApp = {} as MolvisApp;

  it("should pass through when selection is empty", () => {
    const mod = new DeleteSelectedModifier();
    const frame = makeFrame(["C", "O"]);
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.none(2);
    const result = mod.apply(frame, ctx);
    expect(result).toBe(frame);
  });

  it("should remove selected atoms", () => {
    const mod = new DeleteSelectedModifier();
    const frame = makeFrame(["C", "O", "N"]);
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.fromIndices(3, [1]); // delete O
    const result = mod.apply(frame, ctx);

    const atoms = result.get("atoms");
    expect(atoms.nRows).toBe(2);
    const elements = (atoms.copy("element") as string[])!;
    expect([...elements]).toEqual(["C", "N"]);
  });

  it("should remap bond indices after deletion", () => {
    const mod = new DeleteSelectedModifier();
    // Bonds: 0-1 (removed), 0-2 (remapped to 0-1)
    const frame = makeFrame(
      ["C", "H", "O"],
      [
        [0, 1],
        [0, 2],
      ],
    );
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.fromIndices(3, [1]); // delete index 1
    const result = mod.apply(frame, ctx);

    const bonds = result.get("bonds");
    expect(bonds.nRows).toBe(1);
    const iCol = (bonds.view("atomi") as BigUint64Array)!;
    const jCol = (bonds.view("atomj") as BigUint64Array)!;
    expect(Number(iCol[0])).toBe(0); // C stays at 0
    expect(Number(jCol[0])).toBe(1); // O remapped from 2 to 1
  });

  it("should return empty frame when all atoms deleted", () => {
    const mod = new DeleteSelectedModifier();
    const frame = makeFrame(["C", "O"]);
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.fromIndices(2, [0, 1]);
    const result = mod.apply(frame, ctx);
    const atoms = result.has("atoms") ? result.get("atoms") : undefined;
    expect(!atoms || atoms.nRows === 0).toBe(true);
  });

  it("should preserve coordinates after deletion", () => {
    const mod = new DeleteSelectedModifier();
    const frame = makeFrame(["H", "C", "O"]);
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.fromIndices(3, [0]); // delete first atom
    const result = mod.apply(frame, ctx);

    const atoms = result.get("atoms");
    const x = (atoms.view("x") as Float64Array)!;
    expect(x[0]).toBeCloseTo(1, 5); // C was at x=1
    expect(x[1]).toBeCloseTo(2, 5); // O was at x=2
  });

  it("should pass through when selection indices exceed atom count", () => {
    const mod = new DeleteSelectedModifier();
    const frame = makeFrame(["C"]);
    const ctx = createDefaultContext(frame, mockApp);
    // Selection contains index 99 which doesn't exist — needFilter should be false
    ctx.currentSelection = SelectionMask.fromIndices(1, []);
    const result = mod.apply(frame, ctx);
    expect(result).toBe(frame);
  });
});
