import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { computeClusters } from "../../src/analysis/cluster";

/** Two separate dimers (0-1) and (2-3) via bonds. */
function twoMolecules(): Frame {
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0, 1, 10, 11]));
  atoms.setColF("y", new Float64Array([0, 0, 0, 0]));
  atoms.setColF("z", new Float64Array([0, 0, 0, 0]));
  atoms.setColStr("element", ["C", "C", "O", "O"]);
  const bonds = new Block();
  bonds.setColU32("atomi", new Uint32Array([0, 2]));
  bonds.setColU32("atomj", new Uint32Array([1, 3]));
  const frame = new Frame();
  frame.insertBlock("atoms", atoms);
  frame.insertBlock("bonds", bonds);
  return frame;
}

describe("computeClusters bonds mode", () => {
  it("clusters by bond topology subgraphs; isolates are size-1", () => {
    const r = computeClusters(twoMolecules(), { mode: "bonds" });
    expect(r).not.toBeNull();
    expect(r!.numClusters).toBe(2);
    expect(r!.clusterIdx[0]).toBe(r!.clusterIdx[1]);
    expect(r!.clusterIdx[2]).toBe(r!.clusterIdx[3]);
    expect(r!.clusterIdx[0]).not.toBe(r!.clusterIdx[2]);
    expect([...r!.clusterSizes].sort()).toEqual([2, 2]);
  });

  it("gives every atom a cluster when there are no bonds", () => {
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1, 2]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["C", "C", "C"]);
    const frame = new Frame();
    frame.insertBlock("atoms", atoms);
    const r = computeClusters(frame, { mode: "bonds" });
    expect(r!.numClusters).toBe(3);
    expect([...r!.clusterSizes]).toEqual([1, 1, 1]);
  });
});
