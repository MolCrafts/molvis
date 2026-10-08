import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import type { MolvisApp } from "../../src/app";
import { ReplicateModifier } from "../../src/modifiers/ReplicateModifier";
import { createDefaultContext } from "../../src/pipeline/types";

function twoAtomBox(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array([0, 1]));
  atoms.set("y", new Float64Array([0, 0]));
  atoms.set("z", new Float64Array([0, 0]));
  atoms.set("element", ["H", "C"]);
  frame.set("atoms", atoms);
  const bonds = new Block();
  bonds.set("atomi", toDomainUint([0]));
  bonds.set("atomj", toDomainUint([1]));
  frame.set("bonds", bonds);
  frame.box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);
  return frame;
}

describe("ReplicateModifier", () => {
  const mockApp = {} as MolvisApp;

  test("nx=2 doubles atom and bond counts", () => {
    const frame = twoAtomBox();
    const mod = new ReplicateModifier();
    mod.setCounts(2, 1, 1);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(out.get("atoms").nRows).toBe(4);
    expect(out.get("bonds").nRows).toBe(2);
    const x = out.get("atoms").view("x") as Float64Array;
    // Second image shifted by +10 along a (cube edge)
    expect(x?.[2]).toBeCloseTo(10, 5);
    expect(x?.[3]).toBeCloseTo(11, 5);
  });

  test("1×1×1 is pass-through identity counts", () => {
    const frame = twoAtomBox();
    const mod = new ReplicateModifier();
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(out.get("atoms").nRows).toBe(2);
  });

  test("no box skips", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0]));
    atoms.set("y", new Float64Array([0]));
    atoms.set("z", new Float64Array([0]));
    atoms.set("element", ["H"]);
    frame.set("atoms", atoms);
    const mod = new ReplicateModifier();
    mod.setCounts(2, 1, 1);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(out.get("atoms").nRows).toBe(1);
  });
});
