import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { ReplicateModifier } from "../../src/modifiers/ReplicateModifier";
import { createDefaultContext } from "../../src/pipeline/types";

function twoAtomBox(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0, 1]));
  atoms.setColF("y", new Float64Array([0, 0]));
  atoms.setColF("z", new Float64Array([0, 0]));
  atoms.setColStr("element", ["H", "C"]);
  frame.insertBlock("atoms", atoms);
  const bonds = new Block();
  bonds.setColU32("atomi", new Uint32Array([0]));
  bonds.setColU32("atomj", new Uint32Array([1]));
  frame.insertBlock("bonds", bonds);
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
    expect(out.getBlock("atoms")?.nrows()).toBe(4);
    expect(out.getBlock("bonds")?.nrows()).toBe(2);
    const x = out.getBlock("atoms")?.viewColF("x");
    // Second image shifted by +10 along a (cube edge)
    expect(x?.[2]).toBeCloseTo(10, 5);
    expect(x?.[3]).toBeCloseTo(11, 5);
  });

  test("1×1×1 is pass-through identity counts", () => {
    const frame = twoAtomBox();
    const mod = new ReplicateModifier();
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(out.getBlock("atoms")?.nrows()).toBe(2);
  });

  test("no box skips", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    atoms.setColStr("element", ["H"]);
    frame.insertBlock("atoms", atoms);
    const mod = new ReplicateModifier();
    mod.setCounts(2, 1, 1);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    expect(out.getBlock("atoms")?.nrows()).toBe(1);
  });
});
