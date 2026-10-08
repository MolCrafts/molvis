import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import type { MolvisApp } from "../../src/app";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../../src/color_override_keys";
import { AssignColorModifier } from "../../src/modifiers/AssignColorModifier";
import { createDefaultContext, SelectionMask } from "../../src/pipeline/types";

function makeFrame(elements: string[]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array(elements.length));
  atoms.set("y", new Float64Array(elements.length));
  atoms.set("z", new Float64Array(elements.length));
  atoms.set("element", elements);
  frame.set("atoms", atoms);
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

    const atoms = result.get("atoms");
    const r = (atoms.view(COLOR_OVERRIDE_R) as Float64Array)!;
    const g = (atoms.view(COLOR_OVERRIDE_G) as Float64Array)!;
    const b = (atoms.view(COLOR_OVERRIDE_B) as Float64Array)!;

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

    const atoms = result.get("atoms");
    const b = (atoms.view(COLOR_OVERRIDE_B) as Float64Array)!;

    expect(b[0]).toBeGreaterThan(0.5); // atom 0 is blue
    expect(b[1]).toBeGreaterThan(0.5); // atom 1 is blue
  });

  it("should preserve bonds and box", () => {
    const frame = makeFrame(["C", "O"]);
    const bonds = new Block();
    bonds.set("atomi", toDomainUint([0]));
    bonds.set("atomj", toDomainUint([1]));
    frame.set("bonds", bonds);

    const mod = new AssignColorModifier();
    mod.setPrimaryColor("#FF0000");
    const ctx = createDefaultContext(frame, mockApp);
    ctx.currentSelection = SelectionMask.fromIndices(2, [0]);
    const result = mod.apply(frame, ctx);

    expect(result.has("bonds")).toBe(true);
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
