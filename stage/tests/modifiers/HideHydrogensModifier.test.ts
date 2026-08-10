import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { HideHydrogensModifier } from "../../src/modifiers/HideHydrogensModifier";
import { createDefaultContext } from "../../src/pipeline/types";

function makeFrame(
  elements: string[],
  positions?: [number, number, number][],
): Frame {
  const frame = new Frame();
  const atoms = new Block();
  const _n = elements.length;
  const pos =
    positions ?? elements.map((_, i) => [i, 0, 0] as [number, number, number]);
  atoms.setColF("x", new Float64Array(pos.map((p) => p[0])));
  atoms.setColF("y", new Float64Array(pos.map((p) => p[1])));
  atoms.setColF("z", new Float64Array(pos.map((p) => p[2])));
  atoms.setColStr("element", elements);
  frame.insertBlock("atoms", atoms);
  return frame;
}

function makeFrameWithBonds(
  elements: string[],
  bonds: [number, number][],
): Frame {
  const frame = makeFrame(elements);
  const bondsBlock = new Block();
  bondsBlock.setColU32("atomi", new Uint32Array(bonds.map((b) => b[0])));
  bondsBlock.setColU32("atomj", new Uint32Array(bonds.map((b) => b[1])));
  frame.insertBlock("bonds", bondsBlock);
  return frame;
}

describe("HideHydrogensModifier", () => {
  // The modifier never reads `context.app`; the seam only has to exist.
  const mockApp = {} as MolvisApp;

  it("should pass through when disabled", () => {
    const mod = new HideHydrogensModifier();
    mod.hideHydrogens = false;
    const frame = makeFrame(["C", "H", "H", "H", "H"]);
    const ctx = createDefaultContext(frame, mockApp);
    const result = mod.apply(frame, ctx);
    expect(result).toBe(frame); // Same reference, no filtering
  });

  it("should remove hydrogen atoms when enabled", () => {
    const mod = new HideHydrogensModifier();
    mod.hideHydrogens = true;
    const frame = makeFrame(["C", "H", "H", "O", "H"]);
    const ctx = createDefaultContext(frame, mockApp);
    const result = mod.apply(frame, ctx);

    const atoms = result.getBlock("atoms");
    expect(atoms).not.toBeNull();
    expect(atoms?.nrows()).toBe(2); // C and O remain
    const elements = atoms?.copyColStr("element");
    expect(elements).toEqual(["C", "O"]);
  });

  it("should remap bond indices after filtering", () => {
    // Atoms: C(0), H(1), O(2), H(3)
    // Bonds: C-H(0-1), C-O(0-2), O-H(2-3)
    const mod = new HideHydrogensModifier();
    mod.hideHydrogens = true;
    const frame = makeFrameWithBonds(
      ["C", "H", "O", "H"],
      [
        [0, 1],
        [0, 2],
        [2, 3],
      ],
    );
    const ctx = createDefaultContext(frame, mockApp);
    const result = mod.apply(frame, ctx);

    const atoms = result.getBlock("atoms");
    expect(atoms?.nrows()).toBe(2); // C(->0) and O(->1)

    const bonds = result.getBlock("bonds");
    expect(bonds).not.toBeNull();
    expect(bonds?.nrows()).toBe(1); // Only C-O survives

    const iCol = bonds?.viewColU32("atomi");
    const jCol = bonds?.viewColU32("atomj");
    expect(iCol?.[0]).toBe(0); // C remapped to 0
    expect(jCol?.[0]).toBe(1); // O remapped to 1
  });

  it("should pass through if no hydrogens exist", () => {
    const mod = new HideHydrogensModifier();
    mod.hideHydrogens = true;
    const frame = makeFrame(["C", "N", "O"]);
    const ctx = createDefaultContext(frame, mockApp);
    const result = mod.apply(frame, ctx);
    expect(result).toBe(frame); // Same reference
  });

  it("should return empty frame if all atoms are hydrogen", () => {
    const mod = new HideHydrogensModifier();
    mod.hideHydrogens = true;
    const frame = makeFrame(["H", "H", "H"]);
    const ctx = createDefaultContext(frame, mockApp);
    const result = mod.apply(frame, ctx);
    const atoms = result.getBlock("atoms");
    // Either null or zero rows
    expect(!atoms || atoms.nrows() === 0).toBe(true);
  });

  it("should preserve coordinate values for non-H atoms", () => {
    const mod = new HideHydrogensModifier();
    mod.hideHydrogens = true;
    const frame = makeFrame(
      ["H", "C", "H", "O"],
      [
        [0, 0, 0],
        [1, 2, 3],
        [0, 0, 0],
        [4, 5, 6],
      ],
    );
    const ctx = createDefaultContext(frame, mockApp);
    const result = mod.apply(frame, ctx);

    const atoms = result.getBlock("atoms")!;
    const x = atoms.viewColF("x")!;
    const y = atoms.viewColF("y")!;
    const z = atoms.viewColF("z")!;
    expect(x[0]).toBeCloseTo(1, 5); // C
    expect(y[0]).toBeCloseTo(2, 5);
    expect(z[0]).toBeCloseTo(3, 5);
    expect(x[1]).toBeCloseTo(4, 5); // O
    expect(y[1]).toBeCloseTo(5, 5);
    expect(z[1]).toBeCloseTo(6, 5);
  });

  it("should produce different cache keys for different states", () => {
    const mod = new HideHydrogensModifier();
    mod.hideHydrogens = false;
    const key1 = mod.getCacheKey();
    mod.hideHydrogens = true;
    const key2 = mod.getCacheKey();
    expect(key1).not.toBe(key2);
  });

  it("should handle frame with no atoms block", () => {
    const mod = new HideHydrogensModifier();
    mod.hideHydrogens = true;
    const frame = new Frame();
    const ctx = createDefaultContext(frame, mockApp);
    const result = mod.apply(frame, ctx);
    expect(result).toBe(frame);
  });

  it("should handle frame with no element column", () => {
    const mod = new HideHydrogensModifier();
    mod.hideHydrogens = true;
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([1, 2]));
    frame.insertBlock("atoms", atoms);
    const ctx = createDefaultContext(frame, mockApp);
    const result = mod.apply(frame, ctx);
    expect(result).toBe(frame);
  });
});
