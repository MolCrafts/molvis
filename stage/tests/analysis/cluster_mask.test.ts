import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  clusterColumnName,
  computeClusterMaskProperties,
  listClusterColumns,
  readClusterMask,
  summarizeClusterMask,
} from "../../src/analysis/cluster_mask";
import type { MolvisApp } from "../../src/app";
import { ClusterModifier } from "../../src/modifiers/ClusterModifier";
import { createDefaultContext } from "../../src/pipeline/types";
import "../setup_wasm";

function twoClusterFrame(): Frame {
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0, 1.0, 20, 21]));
  atoms.setColF("y", new Float64Array([0, 0, 0, 0]));
  atoms.setColF("z", new Float64Array([0, 0, 0, 0]));
  atoms.setColStr("element", ["C", "C", "O", "O"]);
  const frame = new Frame();
  frame.insertBlock("atoms", atoms);
  frame.box = Box.cube(40, new Float64Array([0, 0, 0]), true, true, true);
  return frame;
}

describe("cluster_mask", () => {
  it("clusterColumnName uses 1-based slots", () => {
    expect(clusterColumnName(1)).toBe("cluster_1");
    expect(clusterColumnName(3)).toBe("cluster_3");
  });

  it("summarizeClusterMask remaps ids and counts sizes", () => {
    const mask = new Int32Array([1, 1, -1, 0, 0, 0]);
    const s = summarizeClusterMask(mask);
    expect(s.numClusters).toBe(2);
    expect(s.clusterSizes[0] + s.clusterSizes[1]).toBe(5);
    expect([...s.clusterIdx].filter((v) => v < 0)).toHaveLength(1);
  });

  it("computeClusterMaskProperties returns COM near cluster means", () => {
    const frame = twoClusterFrame();
    const mask = new Int32Array([0, 0, 1, 1]);
    frame.getBlock("atoms")?.setColI32("cluster_1", mask);
    const props = computeClusterMaskProperties(frame, mask, {}, "cluster_1");
    expect(props).not.toBeNull();
    expect(props!.numClusters).toBe(2);
    expect(props!.centersOfMass[0]).toBeCloseTo(0.5, 5);
    expect(props!.centersOfMass[3]).toBeCloseTo(20.5, 5);
    expect(props!.radiiOfGyration[0]).toBeGreaterThan(0);
    expect(props!.column).toBe("cluster_1");
  });

  it("ClusterModifier writes cluster_{slot}", () => {
    const frame = twoClusterFrame();
    const mod = new ClusterModifier("c1", 2);
    mod.setRMax(2.0);
    mod.setColorScene(false);
    const out = mod.apply(frame, createDefaultContext(frame, {} as MolvisApp));
    expect(mod.columnName).toBe("cluster_2");
    const mask = out.getBlock("atoms")?.viewColI32("cluster_2");
    expect(mask).toBeTruthy();
    expect(mask!.length).toBe(4);
    const assigned = [...mask!].filter((c) => c >= 0);
    expect(assigned.length).toBe(4);
    expect(new Set(assigned).size).toBe(2);
  });

  it("listClusterColumns and readClusterMask prefer latest slot", () => {
    const frame = twoClusterFrame();
    const atoms = frame.getBlock("atoms")!;
    atoms.setColI32("cluster_1", new Int32Array([0, 0, 0, 0]));
    atoms.setColI32("cluster_3", new Int32Array([1, 1, 1, 1]));
    expect(listClusterColumns(frame)).toEqual(["cluster_1", "cluster_3"]);
    const auto = readClusterMask(frame);
    expect(auto?.column).toBe("cluster_3");
    const explicit = readClusterMask(frame, "cluster_1");
    expect(explicit?.column).toBe("cluster_1");
    expect(explicit?.mask[0]).toBe(0);
  });
});
