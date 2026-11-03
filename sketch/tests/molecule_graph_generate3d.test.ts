import { CommandManager } from "@molcrafts/molvis-core/command";
import { Conformer } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { PlaceRingCommand } from "../src/commands/ops_commands";
import { MoleculeGraph } from "../src/molecule_graph";

describe("benzene toFrame → Conformer", () => {
  it("Kekulé benzene yields C6H6 not C6H12", async () => {
    const g = new MoleculeGraph();
    const h = new CommandManager({ events: { emit: () => {} } });
    await h.execute(new PlaceRingCommand(g, 6, 0, 0, undefined, "benzene"));
    const orders = g.getMoleculeData().bonds.map((b) => b.order);
    expect(orders).toEqual([2, 1, 2, 1, 2, 1]);

    const frame2d = g.toFrame();
    try {
      const conformer = new Conformer("fast", true, 42);
      const frame3d = conformer.generate(frame2d);
      conformer.free();
      try {
        const numbers = frame3d
          .get("atoms")
          .copy("atomic_number") as BigUint64Array;
        const nC = numbers.filter((z) => z === 6n).length;
        const nH = numbers.filter((z) => z === 1n).length;
        expect(nC).toBe(6);
        expect(nH).toBe(6);
      } finally {
        frame3d.free();
      }
    } finally {
      frame2d.free();
    }
  });
});
