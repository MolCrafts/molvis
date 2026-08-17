import { CommandManager } from "@molcrafts/molvis-core/command";
import { describe, expect, it } from "@rstest/core";
import {
  AdjustAtomChargeCommand,
  ClearDocumentCommand,
  CycleBondOrderCommand,
  MoveSelectionCommand,
  PlaceRingCommand,
  SetAtomElementCommand,
  SetBondOrderCommand,
  SetBondStereoCommand,
} from "../../src/commands/ops_commands";
import { MoleculeGraph } from "../../src/molecule_graph";

describe("ops commands", () => {
  it("PlaceRingCommand places 6 atoms for benzene with alternating double bonds", async () => {
    const g = new MoleculeGraph();
    const h = new CommandManager({ events: { emit: () => {} } });
    await h.execute(new PlaceRingCommand(g, 6, 0, 0, undefined, "benzene"));
    expect(g.atomCount()).toBe(6);
    expect(g.bondCount()).toBe(6);
    const orders = g.getMoleculeData().bonds.map((b) => b.order);
    // Kekulé: 2,1,2,1,2,1
    expect(orders).toEqual([2, 1, 2, 1, 2, 1]);
    await h.undo();
    expect(g.atomCount()).toBe(0);
  });

  it("CycleBondOrderCommand cycles 1→2→3→1 and clears stereo", async () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "C", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1, stereo: "up" }],
    });
    const h = new CommandManager({ events: { emit: () => {} } });
    await h.execute(new CycleBondOrderCommand(g, 0));
    expect(g.getBond(0).order).toBe(2);
    expect(g.getBond(0).stereo).toBe("none");
  });

  it("SetBondStereoCommand only on single bonds", async () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "C", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    new SetBondStereoCommand(g, 0, "down").do();
    expect(g.getBond(0).stereo).toBe("down");
  });

  it("reapplying a wedge flips its direction and undo restores endpoints", async () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "N", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1, stereo: "up" }],
    });
    const h = new CommandManager({ events: { emit: () => {} } });
    await h.execute(new SetBondStereoCommand(g, 0, "up"));
    expect(g.getBond(0)).toEqual({
      i: 1,
      j: 0,
      order: 1,
      stereo: "up",
    });
    await h.undo();
    expect(g.getBond(0)).toEqual({
      i: 0,
      j: 1,
      order: 1,
      stereo: "up",
    });
  });

  it("sets atom element and explicit bond order with undo symmetry", async () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "C", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1, stereo: "up" }],
    });
    const h = new CommandManager({ events: { emit: () => {} } });
    await h.execute(new SetAtomElementCommand(g, 0, "N"));
    await h.execute(new SetBondOrderCommand(g, 0, 2));
    expect(g.getAtom(0).element).toBe("N");
    expect(g.getBond(0)).toEqual({
      i: 0,
      j: 1,
      order: 2,
      stereo: "none",
    });
    await h.undo();
    expect(g.getBond(0)).toEqual({
      i: 0,
      j: 1,
      order: 1,
      stereo: "up",
    });
    await h.undo();
    expect(g.getAtom(0).element).toBe("C");
  });

  it("AdjustAtomChargeCommand 0→+1→+2→+1", async () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [{ element: "N", x: 0, y: 0 }],
      bonds: [],
    });
    const h = new CommandManager({ events: { emit: () => {} } });
    await h.execute(new AdjustAtomChargeCommand(g, 0, 1));
    await h.execute(new AdjustAtomChargeCommand(g, 0, 1));
    expect(g.getAtom(0).charge).toBe(2);
    await h.execute(new AdjustAtomChargeCommand(g, 0, -1));
    expect(g.getAtom(0).charge).toBe(1);
  });

  it("MoveSelectionCommand undo restores coords", async () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "C", x: 1, y: 0 },
      ],
      bonds: [],
    });
    const h = new CommandManager({ events: { emit: () => {} } });
    await h.execute(new MoveSelectionCommand(g, [0, 1], 1, 0));
    expect(g.getAtom(0).x).toBeCloseTo(1, 8);
    await h.undo();
    expect(g.getAtom(0).x).toBeCloseTo(0, 8);
  });

  it("ClearDocumentCommand empties and undoes", async () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    });
    const h = new CommandManager({ events: { emit: () => {} } });
    await h.execute(new ClearDocumentCommand(g));
    expect(g.atomCount()).toBe(0);
    await h.undo();
    expect(g.atomCount()).toBe(1);
  });
});
