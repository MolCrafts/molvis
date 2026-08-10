import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { AssignColorModifier } from "../../src/modifiers/AssignColorModifier";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../../src/modifiers/ColorByPropertyModifier";
import { createDefaultContext, SelectionMask } from "../../src/pipeline/types";

function makeFrame(elements: string[]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(elements.length));
  atoms.setColF("y", new Float64Array(elements.length));
  atoms.setColF("z", new Float64Array(elements.length));
  atoms.setColStr("element", elements);
  frame.insertBlock("atoms", atoms);
  return frame;
}

describe("AssignColorModifier", () => {
  // The modifier never reads `context.app`; the seam only has to exist.
  const mockApp = {} as MolvisApp;

  it("should pass through when selection is empty", () => {
    const mod = new AssignColorModifier();
    const frame = makeFrame(["C", "O"]);
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.none(2);
    const result = mod.apply(frame, ctx);
    expect(result).toBe(frame);
  });

  it("should inject color override columns for selected atoms", () => {
    const mod = new AssignColorModifier();
    mod.setPrimaryColor("#FF0000");
    const frame = makeFrame(["C", "O", "N"]);
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.fromIndices(3, [0]);
    const result = mod.apply(frame, ctx);

    const atoms = result.getBlock("atoms")!;
    const r = atoms.viewColF(COLOR_OVERRIDE_R)!;
    const g = atoms.viewColF(COLOR_OVERRIDE_G)!;
    const b = atoms.viewColF(COLOR_OVERRIDE_B)!;

    // Atom 0 should be red (linear space)
    expect(r[0]).toBeGreaterThan(0.5);
    expect(g[0]).toBeCloseTo(0, 2);
    expect(b[0]).toBeCloseTo(0, 2);
  });

  it("should color all selected atoms with the primary color", () => {
    const mod = new AssignColorModifier();
    mod.setPrimaryColor("#0000FF"); // blue
    const frame = makeFrame(["C", "O"]);
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.fromIndices(2, [0, 1]);
    const result = mod.apply(frame, ctx);

    const atoms = result.getBlock("atoms")!;
    const b = atoms.viewColF(COLOR_OVERRIDE_B)!;

    expect(b[0]).toBeGreaterThan(0.5); // atom 0 is blue
    expect(b[1]).toBeGreaterThan(0.5); // atom 1 is blue
  });

  it("should preserve bonds and box", () => {
    const frame = makeFrame(["C", "O"]);
    const bonds = new Block();
    bonds.setColU32("atomi", new Uint32Array([0]));
    bonds.setColU32("atomj", new Uint32Array([1]));
    frame.insertBlock("bonds", bonds);

    const mod = new AssignColorModifier();
    mod.setPrimaryColor("#FF0000");
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.fromIndices(2, [0]);
    const result = mod.apply(frame, ctx);

    expect(result.getBlock("bonds")).not.toBeNull();
  });

  it("should produce different cache keys for different colors", () => {
    const mod = new AssignColorModifier();
    const key1 = mod.getCacheKey();
    mod.setPrimaryColor("#00FF00");
    const key2 = mod.getCacheKey();
    expect(key1).not.toBe(key2);
  });

  it("should expose selectedCount after apply", () => {
    const mod = new AssignColorModifier();
    mod.setPrimaryColor("#FF0000");
    const frame = makeFrame(["C", "O", "N"]);
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.fromIndices(3, [0, 2]);
    mod.apply(frame, ctx);

    expect(mod.selectedCount).toBe(2);
  });

  it("should expose default primary color", () => {
    const mod = new AssignColorModifier();
    expect(mod.primaryColor).toBe("#FF4444");
  });
});
