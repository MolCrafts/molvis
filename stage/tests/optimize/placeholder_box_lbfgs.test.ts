import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { SpatialNeighborQuery } from "../../src/algo/neighbor_list";
import { shouldDrawBox } from "../../src/io/box_presence";
import { ComputeBondsModifier } from "../../src/modifiers/ComputeBondsModifier";
import {
  classifyOptimizeFailure,
  formatOptimizeError,
  runLbfgsOptimize,
} from "../../src/optimize/relax";
import "../setup_wasm";

/**
 * Non-PBC cell fixture (product: shouldDrawBox === false → free boundary).
 * Used only to assert neighbor search / topology respect that policy — not
 * as a user-facing failure class.
 */
function compactCarbon(n: number, nonPbcCell: boolean): Frame {
  const frame = new Frame();
  const atoms = new Block();
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const el: string[] = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / 50);
    const inLayer = i % 50;
    x[i] = (inLayer % 10) * 1.4;
    y[i] = Math.floor(inLayer / 10) * 1.4;
    z[i] = layer * 1.4;
    el.push("C");
  }
  atoms.setColF("x", x);
  atoms.setColF("y", y);
  atoms.setColF("z", z);
  atoms.setColStr("element", el);
  frame.insertBlock("atoms", atoms);
  if (nonPbcCell) {
    frame.box = Box.cube(1, new Float64Array([0, 0, 0]), true, true, true);
  }
  return frame;
}

function farEthanol(nonPbcCell: boolean): Frame {
  const frame = new Frame();
  const atoms = new Block();
  const ox = 200.0;
  const oy = 200.0;
  const oz = 200.0;
  atoms.setColF("x", new Float64Array([ox, ox + 1.5, ox + 2.4]));
  atoms.setColF("y", new Float64Array([oy, oy, oy + 0.9]));
  atoms.setColF("z", new Float64Array([oz, oz, oz]));
  atoms.setColStr("element", ["C", "C", "O"]);
  frame.insertBlock("atoms", atoms);
  const bonds = new Block();
  bonds.setColU32("atomi", new Uint32Array([0, 1]));
  bonds.setColU32("atomj", new Uint32Array([1, 2]));
  frame.insertBlock("bonds", bonds);
  if (nonPbcCell) {
    frame.box = Box.cube(1, new Float64Array([0, 0, 0]), true, true, true);
  }
  return frame;
}

describe("free-boundary neighbor policy when !shouldDrawBox", () => {
  it("non-PBC cell is free-boundary ground truth", () => {
    const f = compactCarbon(10, true);
    try {
      expect(f.box).toBeDefined();
      expect(shouldDrawBox(f.box)).toBe(false);
    } finally {
      f.free();
    }
  });

  it("NeighborList pair count matches free-boundary (same geometry)", () => {
    const withCell = compactCarbon(500, true);
    const noCell = compactCarbon(500, false);
    try {
      const q1 = new SpatialNeighborQuery(2.0, {
        distSq: true,
        atomCount: 500,
      });
      const q2 = new SpatialNeighborQuery(2.0, {
        distSq: true,
        atomCount: 500,
      });
      let n1 = 0;
      let n2 = 0;
      try {
        const a = q1.build(withCell);
        const b = q2.build(noCell);
        try {
          n1 = a.numPairs;
          n2 = b.numPairs;
        } finally {
          a.free();
          b.free();
        }
      } finally {
        q1.free();
        q2.free();
      }
      // Neighbors are nonbonded pairs — must not depend on a non-PBC cell.
      expect(n1).toBe(n2);
      expect(n1).toBeLessThan(5_000);
      expect(n1).toBeGreaterThan(100);
    } finally {
      withCell.free();
      noCell.free();
    }
  });

  it("bond topology from perceive stays local under non-PBC cell", () => {
    const f = compactCarbon(500, true);
    let out: Frame | null = null;
    try {
      // Neighbor search → filter → bond topology (not the NL itself).
      out = ComputeBondsModifier.perceiveForForceField(f);
      const nb = out.getBlock("bonds")?.nrows() ?? 0;
      expect(nb).toBeGreaterThan(100);
      expect(nb).toBeLessThan(5_000);
    } finally {
      out?.free();
      f.free();
    }
  });

  it("UFF minimize with non-PBC cell + explicit topology", async () => {
    const f = farEthanol(true);
    try {
      expect(shouldDrawBox(f.box)).toBe(false);
      const r = await runLbfgsOptimize({
        frame: f,
        potential: "uff",
        maxSteps: 30,
        forceTol: 0.5,
        reportEvery: 5,
      });
      expect(r.cancelled).toBe(false);
      expect(Number.isFinite(r.energy)).toBe(true);
    } finally {
      f.free();
    }
  }, 30_000);
});

describe("optimize failure classes", () => {
  it("classifies neighborlist overflow vs bad topology", () => {
    expect(classifyOptimizeFailure("capacity overflow")).toBe(
      "neighborlist_overflow",
    );
    expect(
      classifyOptimizeFailure("UFF: parameters missing for label 'C_5'"),
    ).toBe("bad_chemical_topology");
  });

  it("formatOptimizeError never blames a cell or bare unreachable", () => {
    const msg = formatOptimizeError(new Error("unreachable"));
    expect(msg).not.toBe("unreachable");
    expect(msg).not.toMatch(/1\s*[×x]\s*1|cryo-EM|placeholder cell/i);
    expect(msg).toMatch(/NeighborList overflow|chemical topology/i);
  });
});
