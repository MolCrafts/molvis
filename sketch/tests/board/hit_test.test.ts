import { describe, expect, it } from "@rstest/core";
import { HitTester } from "../../src/board/hit_test";
import { MoleculeGraph } from "../../src/molecule_graph";

describe("HitTester", () => {
  it("hits atom inside radius and prefers atom over bond", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "O", x: 1.2, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    const hit = new HitTester(0.35, 0.2);
    expect(hit.hit(g, 0.05, 0)).toEqual({ kind: "atom", index: 0 });
    expect(hit.hit(g, 0.6, 0).kind).toBe("bond");
    expect(hit.hit(g, 5, 5)).toEqual({ kind: "none" });
  });

  it("empty graph misses", () => {
    const g = new MoleculeGraph();
    expect(new HitTester(0.35, 0.2).hit(g, 0, 0)).toEqual({ kind: "none" });
  });
});
