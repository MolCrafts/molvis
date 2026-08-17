/**
 * molrs chemical perception — Perceive.findHydrogens (OOP), not a free fn.
 */
import { Block, Frame, Perceive } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";

function bareCarbon(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0]));
  atoms.setColF("y", new Float64Array([0]));
  atoms.setColF("z", new Float64Array([0]));
  atoms.setColStr("element", ["C"]);
  frame.insertBlock("atoms", atoms);
  return frame;
}

function ethaneSkeleton(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0, 1.5]));
  atoms.setColF("y", new Float64Array([0, 0]));
  atoms.setColF("z", new Float64Array([0, 0]));
  atoms.setColStr("element", ["C", "C"]);
  frame.insertBlock("atoms", atoms);
  const bonds = new Block();
  bonds.setColU32("atomi", new Uint32Array([0]));
  bonds.setColU32("atomj", new Uint32Array([1]));
  bonds.setColU32("bond_type", new Uint32Array([1]));
  bonds.setColU32("bond_number", new Uint32Array([1]));
  frame.insertBlock("bonds", bonds);
  return frame;
}

describe("Perceive.findHydrogens", () => {
  it("adds 4 H to bare carbon", () => {
    const input = bareCarbon();
    const out = new Perceive().findHydrogens(input);
    const n = out.getBlock("atoms")?.nrows() ?? 0;
    expect(n).toBe(5);
    const els = out.getBlock("atoms")?.copyColStr("element") ?? [];
    expect(els.filter((e: string) => e === "H" || e === "h")).toHaveLength(4);
    input.free();
    out.free();
  });

  it("adds 6 H to C–C (ethane skeleton)", () => {
    const input = ethaneSkeleton();
    const out = new Perceive().findHydrogens(input);
    const n = out.getBlock("atoms")?.nrows() ?? 0;
    expect(n).toBe(8); // 2 C + 6 H
    const bonds = out.getBlock("bonds")?.nrows() ?? 0;
    expect(bonds).toBe(7); // 1 C–C + 6 C–H
    input.free();
    out.free();
  });

  it("removeHydrogens strips terminal H", () => {
    const input = bareCarbon();
    const withH = new Perceive().findHydrogens(input);
    const heavy = new Perceive().removeHydrogens(withH);
    expect(heavy.getBlock("atoms")?.nrows()).toBe(1);
    input.free();
    withH.free();
    heavy.free();
  });
});
