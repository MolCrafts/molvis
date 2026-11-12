import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import { computeClusters } from "../../src/analysis/cluster";

/** Two separate dimers (0-1) and (2-3) via bonds. */
function twoMolecules(): Frame {
  const atoms = new Block();
  atoms.set("x", new Float64Array([0, 1, 10, 11]));
  atoms.set("y", new Float64Array([0, 0, 0, 0]));
  atoms.set("z", new Float64Array([0, 0, 0, 0]));
  atoms.set("element", ["C", "C", "O", "O"]);
  const bonds = new Block();
  bonds.set("atomi", toDomainUint([0, 2]));
  bonds.set("atomj", toDomainUint([1, 3]));
  const frame = new Frame();
  frame.set("atoms", atoms);
  frame.set("bonds", bonds);
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
    atoms.set("x", new Float64Array([0, 1, 2]));
    atoms.set("y", new Float64Array([0, 0, 0]));
    atoms.set("z", new Float64Array([0, 0, 0]));
    atoms.set("element", ["C", "C", "C"]);
    const frame = new Frame();
    frame.set("atoms", atoms);
    const r = computeClusters(frame, { mode: "bonds" });
    expect(r!.numClusters).toBe(3);
    expect([...r!.clusterSizes]).toEqual([1, 1, 1]);
  });
});
