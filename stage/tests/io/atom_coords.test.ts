import { Block } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  resolveAtomCoordColumns,
  viewAtomCoords,
} from "../../src/io/atom_coords";
import "../setup_wasm";

describe("atom_coords", () => {
  it("prefers x/y/z when both wrapped and unwrapped coordinates exist", () => {
    const atoms = new Block();
    atoms.set("x", new Float64Array([1, 2]));
    atoms.set("y", new Float64Array([3, 4]));
    atoms.set("z", new Float64Array([5, 6]));
    atoms.set("xu", new Float64Array([10, 20]));
    atoms.set("yu", new Float64Array([30, 40]));
    atoms.set("zu", new Float64Array([50, 60]));

    const columns = resolveAtomCoordColumns(atoms);
    const coords = viewAtomCoords(atoms);

    expect(columns).toEqual({ x: "x", y: "y", z: "z" });
    expect(Array.from(coords?.x ?? [])).toEqual([1, 2]);
    expect(Array.from(coords?.y ?? [])).toEqual([3, 4]);
    expect(Array.from(coords?.z ?? [])).toEqual([5, 6]);
  });

  it("falls back to xu/yu/zu when x/y/z are absent", () => {
    const atoms = new Block();
    atoms.set("xu", new Float64Array([10, 20]));
    atoms.set("yu", new Float64Array([30, 40]));
    atoms.set("zu", new Float64Array([50, 60]));

    const columns = resolveAtomCoordColumns(atoms);
    const coords = viewAtomCoords(atoms);

    expect(columns).toEqual({ x: "xu", y: "yu", z: "zu" });
    expect(Array.from(coords?.x ?? [])).toEqual([10, 20]);
    expect(Array.from(coords?.y ?? [])).toEqual([30, 40]);
    expect(Array.from(coords?.z ?? [])).toEqual([50, 60]);
  });

  it("rejects mixed wrapped and unwrapped triplets", () => {
    const atoms = new Block();
    atoms.set("x", new Float64Array([1]));
    atoms.set("y", new Float64Array([2]));
    atoms.set("zu", new Float64Array([3]));

    expect(resolveAtomCoordColumns(atoms)).toBeUndefined();
    expect(viewAtomCoords(atoms)).toBeUndefined();
  });
});
