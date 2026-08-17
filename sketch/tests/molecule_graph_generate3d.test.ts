import { CommandManager } from "@molcrafts/molvis-core/command";
import { generate3D } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { PlaceRingCommand } from "../src/commands/ops_commands";
import { MoleculeGraph } from "../src/molecule_graph";

describe("benzene toFrame → generate3D", () => {
  it("Kekulé benzene yields C6H6 not C6H12", async () => {
    const g = new MoleculeGraph();
    const h = new CommandManager({ events: { emit: () => {} } });
    await h.execute(new PlaceRingCommand(g, 6, 0, 0, undefined, "benzene"));
    const orders = g.getMoleculeData().bonds.map((b) => b.order);
    expect(orders).toEqual([2, 1, 2, 1, 2, 1]);

    const frame2d = g.toFrame();
    try {
      const frame3d = generate3D(frame2d, "fast", 42);
      try {
        const els = Array.from(
          frame3d.getBlock("atoms")?.copyColStr("element") ?? [],
        );
        const nC = els.filter((e) => e === "C").length;
        const nH = els.filter((e) => e === "H").length;
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
