import { toDomainUint } from "@molcrafts/molvis-core";
import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  analyzeTopology,
  getTopologyDegree,
  getTopologyNeighbors,
} from "../../src/analysis/topology_analysis";

function water(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array([0, 1, 0]));
  atoms.set("y", new Float64Array([0, 0, 1]));
  atoms.set("z", new Float64Array([0, 0, 0]));
  frame.set("atoms", atoms);
  const bonds = new Block();
  bonds.set("atomi", toDomainUint([0, 0]));
  bonds.set("atomj", toDomainUint([1, 2]));
  frame.set("bonds", bonds);
  return frame;
}

describe("analyzeTopology", () => {
  it("reads atomi/atomj into the graph", () => {
    const result = analyzeTopology(water());
    expect(result).not.toBeNull();
    expect(result!.nAtoms).toBe(3);
    expect(result!.nBonds).toBe(2);
    expect(result!.nAngles).toBe(1);
    expect(result!.nComponents).toBe(1);
    expect(getTopologyDegree(water(), 0)).toBe(2);
    expect(getTopologyNeighbors(water(), 0).sort()).toEqual([1, 2]);
  });
});
