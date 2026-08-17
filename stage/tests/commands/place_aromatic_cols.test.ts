import { Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { generate3D, parseSMILES } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../../src/app";
import { PlaceMoleculeCommand } from "../../src/commands/place_molecule";

describe("PlaceMoleculeCommand aromatic SMILES", () => {
  it("uses molrs Kekulé bond_number on c1ccccc1 ring bonds", async () => {
    const ir = parseSMILES("c1ccccc1");
    const f2 = ir.toFrame();
    const frame = generate3D(f2, "fast", 42);
    f2.free();
    ir.free();

    const drawn: Array<{ bondType?: number; bondNumber?: number }> = [];
    let nextAtom = 0;
    let nextBond = 0;
    const mockApp = {
      world: {
        sceneIndex: {
          getNextAtomId: () => nextAtom++,
          getNextBondId: () => nextBond++,
        },
      },
      artist: {
        async drawAtom() {
          return { atomId: 0, meshId: 0 };
        },
        async drawBond(
          _s: Vector3,
          _e: Vector3,
          options: Record<string, unknown>,
        ) {
          drawn.push(options as { bondType?: number; bondNumber?: number });
          return { bondId: 0, meshId: 0 };
        },
      },
    } as unknown as MolvisApp;

    await new PlaceMoleculeCommand(mockApp, frame, new Vector3(0, 0, 0)).do();

    const ring = drawn.filter((d) => d.bondType === 4);
    expect(ring.length).toBe(6);
    // molrs findKekuleOrders: localized 1|2, not all zero / all single.
    expect(ring.every((d) => d.bondNumber === 1 || d.bondNumber === 2)).toBe(
      true,
    );
    expect(ring.some((d) => d.bondNumber === 2)).toBe(true);
    expect(ring.some((d) => d.bondNumber === 1)).toBe(true);

    frame.free();
  });
});
