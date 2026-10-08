import { toDomainUint } from "@molcrafts/molvis-core";
import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  BondColumnRemapModifier,
  inferBondColumnMapping,
} from "../../src/pipeline/bond_column_remap";
import type { PipelineContext } from "../../src/pipeline/types";

/** Bonds keyed by persistent atom id (LAMMPS `dump local` shape). */
function frameWithIdBonds(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array([0, 1, 2]));
  atoms.set("y", new Float64Array(3));
  atoms.set("z", new Float64Array(3));
  atoms.set("id", toDomainUint([30, 10, 20]));
  frame.set("atoms", atoms);
  const bonds = new Block();
  bonds.set("id_i", toDomainUint([10, 20]));
  bonds.set("id_j", toDomainUint([20, 30]));
  frame.set("bonds", bonds);
  frame.box = Box.cube(5, new Float64Array([0, 0, 0]), true, true, true);
  return frame;
}

describe("BondColumnRemapModifier", () => {
  it("writes canonical atomi/atomj onto a new frame and leaves the input untouched", () => {
    const modifier = new BondColumnRemapModifier("remap", {
      atomiSource: "id_i",
      atomjSource: "id_j",
      offset: 0,
    });
    const input = frameWithIdBonds();

    const out = modifier.apply(input, {} as PipelineContext);

    expect(out).not.toBe(input);
    const bonds = out.has("bonds") ? out.get("bonds") : undefined;
    expect(
      Array.from((bonds?.copy("atomi") as BigUint64Array) ?? [], Number),
    ).toEqual([1, 2]);
    expect(
      Array.from((bonds?.copy("atomj") as BigUint64Array) ?? [], Number),
    ).toEqual([2, 0]);
    // Copy-on-write: the input (possibly a cached provider frame) is intact.
    const inputBonds = input.has("bonds") ? input.get("bonds") : undefined;
    expect(inputBonds?.has("atomi")).toBe(false);
    expect(inputBonds?.has("atomj")).toBe(false);
    expect(out.get("atoms").nRows).toBe(3);
    const box = out.box;
    try {
      expect(box?.volume()).toBe(125);
    } finally {
      box?.free();
    }
  });

  it("throws when a bond endpoint id is missing from atoms.id", () => {
    const modifier = new BondColumnRemapModifier("remap", {
      atomiSource: "id_i",
      atomjSource: "id_j",
      offset: 0,
    });
    const input = frameWithIdBonds();
    const bonds = input.has("bonds") ? input.get("bonds") : undefined;
    bonds?.set("id_i", toDomainUint([10, 99]));

    expect(() => modifier.apply(input, {} as PipelineContext)).toThrow(
      /not in this structure's atom id column/,
    );
  });

  it("passes a frame that already has atomi/atomj through by identity", () => {
    const modifier = new BondColumnRemapModifier("remap", {
      atomiSource: "id_i",
      atomjSource: "id_j",
      offset: 0,
    });
    const input = frameWithIdBonds();
    const once = modifier.apply(input, {} as PipelineContext);
    expect(modifier.apply(once, {} as PipelineContext)).toBe(once);
  });
});

/** Bonds in the `batom1`/`batom2` shape a LAMMPS `dump local` overlay has. */
function frameWithDumpLocalBonds(): Frame {
  const frame = new Frame();
  const bonds = new Block();
  bonds.set("batom1", toDomainUint([10, 20]));
  bonds.set("batom2", toDomainUint([20, 30]));
  frame.set("bonds", bonds);
  return frame;
}

describe("inferBondColumnMapping", () => {
  it("maps the dump local endpoint pair without asking", () => {
    expect(inferBondColumnMapping(frameWithDumpLocalBonds())).toEqual({
      atomiSource: "batom1",
      atomjSource: "batom2",
      offset: 0,
    });
  });

  it("declines endpoint names it cannot recognise", () => {
    expect(inferBondColumnMapping(frameWithIdBonds())).toBe(null);
  });

  it("declines a bonds block missing one of the pair", () => {
    const frame = new Frame();
    const bonds = new Block();
    bonds.set("batom1", toDomainUint([10, 20]));
    frame.set("bonds", bonds);
    expect(inferBondColumnMapping(frame)).toBe(null);
  });

  it("declines an empty bonds block", () => {
    const frame = new Frame();
    frame.set("bonds", new Block());
    expect(inferBondColumnMapping(frame)).toBe(null);
  });

  it("declines a frame with no bonds block", () => {
    expect(inferBondColumnMapping(new Frame())).toBe(null);
  });
});
