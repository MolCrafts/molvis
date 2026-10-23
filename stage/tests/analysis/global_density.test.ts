import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  AMU_PER_A3_TO_G_CM3,
  computeGlobalDensity,
} from "../../src/analysis/global_density";

function frameOf(elements: string[], masses?: number[], boxLen = 10): Frame {
  const n = elements.length;
  const atoms = new Block();
  atoms.set("element", elements);
  atoms.set("x", new Float64Array(n));
  atoms.set("y", new Float64Array(n));
  atoms.set("z", new Float64Array(n));
  if (masses) atoms.set("mass", Float64Array.from(masses));
  const frame = new Frame();
  frame.set("atoms", atoms);
  frame.box = Box.ortho(
    Float64Array.from([boxLen, boxLen, boxLen]),
    Float64Array.from([0, 0, 0]),
    true,
    true,
    true,
  );
  return frame;
}

describe("computeGlobalDensity", () => {
  it("reports N/V for every atom in the cell", () => {
    const frame = frameOf(["C", "C", "H", "H"]);
    const result = computeGlobalDensity(frame, { species: "all" });
    expect(result.volume).toBe(1000);
    expect(result.rows).toEqual([
      {
        label: "all",
        nAtoms: 4,
        numberDensity: 0.004,
        massDensity: null,
      },
    ]);
  });

  it("splits by element and converts mass density", () => {
    const frame = frameOf(["C", "H", "H"], [12, 1, 1]);
    const result = computeGlobalDensity(frame, { species: "each" });
    expect(result.rows.map((r) => r.label)).toEqual(["C", "H"]);
    expect(result.rows[0]?.nAtoms).toBe(1);
    expect(result.rows[1]?.nAtoms).toBe(2);
    expect(result.rows[0]?.massDensity).toBeCloseTo(
      (12 / 1000) * AMU_PER_A3_TO_G_CM3,
      10,
    );
  });

  it("restricts a named species to the selection", () => {
    const frame = frameOf(["C", "C", "H"]);
    const result = computeGlobalDensity(frame, {
      species: "C",
      selected: [1, 2],
    });
    expect(result.rows).toEqual([
      {
        label: "C",
        nAtoms: 1,
        numberDensity: 0.001,
        massDensity: null,
      },
    ]);
  });

  it("refuses a frame without a cell", () => {
    const atoms = new Block();
    atoms.set("element", ["C"]);
    atoms.set("x", new Float64Array([0]));
    atoms.set("y", new Float64Array([0]));
    atoms.set("z", new Float64Array([0]));
    const frame = new Frame();
    frame.set("atoms", atoms);
    expect(() => computeGlobalDensity(frame, { species: "all" })).toThrow(
      /simulation cell/i,
    );
  });
});
