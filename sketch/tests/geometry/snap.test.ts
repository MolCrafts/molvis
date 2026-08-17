import { describe, expect, it } from "@rstest/core";
import {
  findAtom,
  resolveBondTarget,
  SNAP_RADIUS,
  snapDirection,
} from "../../src/geometry/snap";
import { MoleculeGraph } from "../../src/molecule_graph";

describe("findAtom", () => {
  it("returns nearest within SNAP_RADIUS", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    });
    expect(findAtom(g, 0.1, 0, SNAP_RADIUS)).toBe(0);
    expect(findAtom(g, 1, 0, SNAP_RADIUS)).toBeNull();
  });
});

describe("snapDirection", () => {
  it("snaps ~20° toward 30° grid", () => {
    const ang = (20 * Math.PI) / 180;
    const { ux, uy } = snapDirection(Math.cos(ang), Math.sin(ang));
    const out = (Math.atan2(uy, ux) * 180) / Math.PI;
    expect(out).toBeCloseTo(30, 5);
  });
});

describe("resolveBondTarget", () => {
  it("connects to existing atom when pointer is near it", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "O", x: 1, y: 0 },
      ],
      bonds: [],
    });
    const t = resolveBondTarget(g, 0, 1.1, 0.05);
    expect(t.existingIndex).toBe(1);
  });
});
