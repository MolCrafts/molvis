import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";

describe("Block has / copy", () => {
  it("has is true for x and copy reads it", () => {
    const atoms = new Block();
    atoms.set("x", new Float64Array([1]));
    expect(atoms.has("x")).toBe(true);
    expect(Array.from(atoms.copy("x") as Float64Array)).toEqual([1]);
  });

  it("has is false for a missing res_seq and copy throws", () => {
    const atoms = new Block();
    atoms.set("x", new Float64Array([0]));
    expect(atoms.has("res_seq")).toBe(false);
    expect(() => atoms.copy("res_seq")).toThrow(/res_seq/);
  });

  it("copy returns the default only when the key is absent", () => {
    const atoms = new Block();
    const fallback = toDomainUint([9]);
    expect(
      Array.from(atoms.copy("id", fallback) as BigUint64Array, Number),
    ).toEqual([9]);
    atoms.set("x", new Float64Array([1]));
    // Present column: its own dtype wins and the fallback is ignored.
    expect(Array.from(atoms.copy("x", fallback) as Float64Array)).toEqual([1]);
  });

  it("Frame.has / get read a named block", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.set("type_id", toDomainUint([1, 2]));
    expect(frame.has("atoms")).toBe(true);
    expect(frame.get("atoms").has("type_id")).toBe(true);
    expect(frame.get("atoms").has("res_seq")).toBe(false);
    expect(
      Array.from(frame.get("atoms").copy("type_id") as BigUint64Array, Number),
    ).toEqual([1, 2]);
  });
});
