import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
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
  atoms.set("x", new Float64Array(pos.map((p) => p[0])));
  atoms.set("y", new Float64Array(pos.map((p) => p[1])));
  atoms.set("z", new Float64Array(pos.map((p) => p[2])));
  atoms.set("element", elements);
  frame.set("atoms", atoms);
  return frame;
}

function makeFrameWithBonds(
  elements: string[],
  bonds: [number, number][],
): Frame {
  const frame = makeFrame(elements);
  const bondsBlock = new Block();
  bondsBlock.set("atomi", toDomainUint(bonds.map((b) => b[0])));
  bondsBlock.set("atomj", toDomainUint(bonds.map((b) => b[1])));
  frame.set("bonds", bondsBlock);
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

    const atoms = result.has("atoms") ? result.get("atoms") : undefined;
    expect(atoms).not.toBeNull();
    expect(atoms?.nRows).toBe(2); // C and O remain
    const elements = atoms?.copy("element") as string[];
    expect([...elements]).toEqual(["C", "O"]);
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

    const atoms = result.has("atoms") ? result.get("atoms") : undefined;
    expect(atoms?.nRows).toBe(2); // C(->0) and O(->1)

    const bonds = result.has("bonds") ? result.get("bonds") : undefined;
    expect(bonds).not.toBeNull();
    expect(bonds?.nRows).toBe(1); // Only C-O survives

    const iCol = bonds?.view("atomi") as BigUint64Array;
    const jCol = bonds?.view("atomj") as BigUint64Array;
    expect(Number(iCol?.[0])).toBe(0); // C remapped to 0
    expect(Number(jCol?.[0])).toBe(1); // O remapped to 1
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
    const atoms = result.has("atoms") ? result.get("atoms") : undefined;
    // Either null or zero rows
    expect(!atoms || atoms.nRows === 0).toBe(true);
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

    const atoms = result.get("atoms");
    const x = (atoms.view("x") as Float64Array)!;
    const y = (atoms.view("y") as Float64Array)!;
    const z = (atoms.view("z") as Float64Array)!;
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

  it("throws when enabled without an element column", () => {
    const mod = new HideHydrogensModifier();
    mod.hideHydrogens = true;
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([1, 2]));
    frame.set("atoms", atoms);
    const ctx = createDefaultContext(frame, mockApp);
    expect(() => mod.apply(frame, ctx)).toThrow(/element/);
  });
});
