import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import type { MolvisApp } from "../../src/app";
import { ComputeBondsModifier } from "../../src/modifiers/ComputeBondsModifier";
import { createDefaultContext } from "../../src/pipeline/types";

/**
 * Build a frame from explicit per-atom coordinates and element symbols.
 * coords is a flat [x0,y0,z0, x1,y1,z1, ...] array.
 */
function makeFrame(elements: string[], coords: number[]): Frame {
  const n = elements.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = coords[i * 3];
    y[i] = coords[i * 3 + 1];
    z[i] = coords[i * 3 + 2];
  }
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", x);
  atoms.set("y", y);
  atoms.set("z", z);
  atoms.set("element", elements);
  frame.set("atoms", atoms);
  return frame;
}

/** Collect bond pairs as a normalized Set of "i-j" (i<j) strings. */
function bondSet(frame: Frame): Set<string> {
  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  const out = new Set<string>();
  if (!bonds) return out;
  const i = (bonds.view("atomi") as BigUint64Array)!;
  const j = (bonds.view("atomj") as BigUint64Array)!;
  for (let b = 0; b < bonds.nRows; b++) {
    const lo = Math.min(Number(i[b]), Number(j[b]));
    const hi = Math.max(Number(i[b]), Number(j[b]));
    out.add(`${lo}-${hi}`);
  }
  return out;
}

describe("ComputeBondsModifier", () => {
  // The modifier never reads `context.app`; the seam only has to exist.
  const mockApp = {} as MolvisApp;

  it("does not auto-match; Create bonds is opt-in", () => {
    const bondless = makeFrame(["C", "O"], [0, 0, 0, 1.2, 0, 0]);
    expect(new ComputeBondsModifier().matches(bondless)).toBe(false);
  });

  it("passes through frames with fewer than two atoms", () => {
    const mod = new ComputeBondsModifier();
    const frame = makeFrame(["C"], [0, 0, 0]);
    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(result).toBe(frame);
  });

  it("distance criterion: bonds pairs within the cutoff only", () => {
    // Three atoms in a line at x = 0, 1.0, 3.0
    const frame = makeFrame(["C", "C", "C"], [0, 0, 0, 1.0, 0, 0, 3.0, 0, 0]);
    const mod = new ComputeBondsModifier();
    mod.criterion = "distance";
    mod.cutoff = 1.5;
    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    // 0-1 (d=1.0) bonds; 1-2 (d=2.0) and 0-2 (d=3.0) exceed cutoff
    expect(bondSet(result)).toEqual(new Set(["0-1"]));
  });

  it("distance criterion: minDistance rejects near-coincident atoms", () => {
    const frame = makeFrame(["C", "C"], [0, 0, 0, 0.1, 0, 0]);
    const mod = new ComputeBondsModifier();
    mod.criterion = "distance";
    mod.cutoff = 2.0;
    mod.minDistance = 0.4;
    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(bondSet(result).size).toBe(0);
  });

  it("covalent criterion: bonds a C-C pair at typical bond length", () => {
    // C covalent radius 0.77; (0.77+0.77)*1.2 = 1.848 A threshold.
    const frame = makeFrame(["C", "C"], [0, 0, 0, 1.5, 0, 0]);
    const mod = new ComputeBondsModifier();
    mod.criterion = "covalent";
    mod.tolerance = 1.2;
    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(bondSet(result)).toEqual(new Set(["0-1"]));
  });

  it("covalent criterion: rejects a pair beyond the scaled radii sum", () => {
    // 2.0 A > 1.848 A threshold for C-C at tol 1.2.
    const frame = makeFrame(["C", "C"], [0, 0, 0, 2.0, 0, 0]);
    const mod = new ComputeBondsModifier();
    mod.criterion = "covalent";
    mod.tolerance = 1.2;
    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(bondSet(result).size).toBe(0);
  });

  it("covalent criterion: tolerance widens the bonding envelope", () => {
    const frame = makeFrame(["C", "C"], [0, 0, 0, 2.0, 0, 0]);
    const mod = new ComputeBondsModifier();
    mod.criterion = "covalent";
    // (0.77+0.77)*1.4 = 2.156 A now exceeds 2.0 A → bonds.
    mod.tolerance = 1.4;
    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(bondSet(result)).toEqual(new Set(["0-1"]));
  });

  it("replaces any pre-existing bonds block", () => {
    const frame = makeFrame(["C", "C"], [0, 0, 0, 5.0, 0, 0]);
    const stale = new Block();
    stale.set("atomi", toDomainUint([0]));
    stale.set("atomj", toDomainUint([1]));
    frame.set("bonds", stale);

    const mod = new ComputeBondsModifier();
    mod.criterion = "distance";
    mod.cutoff = 1.5;
    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    // Atoms are 5 A apart — perception finds nothing, stale bond is dropped.
    expect(bondSet(result).size).toBe(0);
  });

  it("covalent criterion without an element column passes through", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0, 1]));
    atoms.set("y", new Float64Array([0, 0]));
    atoms.set("z", new Float64Array([0, 0]));
    frame.set("atoms", atoms);

    const mod = new ComputeBondsModifier();
    mod.criterion = "covalent";
    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(result).toBe(frame);
  });

  it("supports LAMMPS-unwrapped xu/yu/zu coordinate columns", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("xu", new Float64Array([0, 1.0, 3.0]));
    atoms.set("yu", new Float64Array([0, 0, 0]));
    atoms.set("zu", new Float64Array([0, 0, 0]));
    atoms.set("element", ["C", "C", "C"]);
    frame.set("atoms", atoms);

    const mod = new ComputeBondsModifier();
    mod.criterion = "distance";
    mod.cutoff = 1.5;
    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    // Same geometry as the x/y/z line test: only 0-1 (d=1.0) bonds.
    expect(bondSet(result)).toEqual(new Set(["0-1"]));
  });

  it("hasElementData reflects presence of the element column", () => {
    const withEl = makeFrame(["C", "O"], [0, 0, 0, 1, 0, 0]);
    expect(ComputeBondsModifier.hasElementData(withEl)).toBe(true);

    const noEl = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0, 1]));
    atoms.set("y", new Float64Array([0, 0]));
    atoms.set("z", new Float64Array([0, 0]));
    noEl.set("atoms", atoms);
    expect(ComputeBondsModifier.hasElementData(noEl)).toBe(false);
  });

  it("cache key reflects criterion and parameters", () => {
    const mod = new ComputeBondsModifier();
    mod.criterion = "covalent";
    mod.tolerance = 1.2;
    const key1 = mod.getCacheKey();
    mod.tolerance = 1.3;
    expect(mod.getCacheKey()).not.toBe(key1);
  });
});
