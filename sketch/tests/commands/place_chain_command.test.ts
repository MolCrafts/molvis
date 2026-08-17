import { CommandManager } from "@molcrafts/molvis-core/command";
import { describe, expect, it } from "@rstest/core";
import { PlaceChainCommand } from "../../src/commands/place_chain_command";
import { MoleculeGraph } from "../../src/molecule_graph";

describe("PlaceChainCommand", () => {
  it("commits a reversible three-segment single-bond chain at 120 degrees", async () => {
    const graph = new MoleculeGraph();
    const before = {
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    };
    graph.loadMoleculeData(before);
    const history = new CommandManager({ events: { emit: () => {} } });

    await history.execute(new PlaceChainCommand(graph, 0, 3, 0, 1, 1));
    const after = graph.getMoleculeData();
    expect(after.atoms).toHaveLength(4);
    expect(after.bonds).toEqual([
      { i: 0, j: 1, order: 1 },
      { i: 1, j: 2, order: 1 },
      { i: 2, j: 3, order: 1 },
    ]);
    for (let index = 1; index < after.atoms.length - 1; index++) {
      const previous = after.atoms[index - 1];
      const current = after.atoms[index];
      const next = after.atoms[index + 1];
      const ax = previous.x - current.x;
      const ay = previous.y - current.y;
      const bx = next.x - current.x;
      const by = next.y - current.y;
      const cosine =
        (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
      const angleDegrees =
        (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
      expect(angleDegrees).toBeCloseTo(120, 6);
    }

    await history.undo();
    expect(graph.getMoleculeData()).toEqual(before);
    await history.redo();
    expect(graph.getMoleculeData()).toEqual(after);
  });

  it("does not consume an already bonded neighbor as a new chain segment", async () => {
    const graph = new MoleculeGraph();
    graph.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: -1 },
        { element: "C", x: 0.866, y: -0.5 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    const history = new CommandManager({ events: { emit: () => {} } });
    await history.execute(new PlaceChainCommand(graph, 0, 2.4, 0, 1.2, 1));

    expect(graph.atomCount()).toBe(4);
    expect(graph.bondCount()).toBe(3);
    expect(graph.findBondIndex(0, 2)).not.toBeNull();
    await history.undo();
    expect(graph.atomCount()).toBe(2);
    expect(graph.bondCount()).toBe(1);
  });
});
