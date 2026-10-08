/**
 * molrs chemical perception — `addHydrogens` / `removeHydrogens`.
 */
import {
  addHydrogens,
  Block,
  Frame,
  removeHydrogens,
} from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";

function bareCarbon(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array([0]));
  atoms.set("y", new Float64Array([0]));
  atoms.set("z", new Float64Array([0]));
  atoms.set("element", ["C"]);
  frame.set("atoms", atoms);
  return frame;
}

function ethaneSkeleton(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array([0, 1.5]));
  atoms.set("y", new Float64Array([0, 0]));
  atoms.set("z", new Float64Array([0, 0]));
  atoms.set("element", ["C", "C"]);
  frame.set("atoms", atoms);
  const bonds = new Block();
  bonds.set("atomi", toDomainUint([0]));
  bonds.set("atomj", toDomainUint([1]));
  bonds.set("bond_type", toDomainUint([1]));
  bonds.set("bond_number", toDomainUint([1]));
  frame.set("bonds", bonds);
  return frame;
}

describe("addHydrogens", () => {
  it("adds 4 H to bare carbon", () => {
    const input = bareCarbon();
    const out = addHydrogens(input);
    expect(out.get("atoms").nRows).toBe(5);
    const els = out.get("atoms").copy("element") as string[];
    expect(els.filter((e: string) => e === "H" || e === "h")).toHaveLength(4);
    input.free();
    out.free();
  });

  it("adds 6 H to C–C (ethane skeleton)", () => {
    const input = ethaneSkeleton();
    const out = addHydrogens(input);
    expect(out.get("atoms").nRows).toBe(8); // 2 C + 6 H
    expect(out.get("bonds").nRows).toBe(7); // 1 C–C + 6 C–H
    input.free();
    out.free();
  });

  it("removeHydrogens strips terminal H", () => {
    const input = bareCarbon();
    const withH = addHydrogens(input);
    const heavy = removeHydrogens(withH);
    expect(heavy.get("atoms").nRows).toBe(1);
    input.free();
    withH.free();
    heavy.free();
  });
});
