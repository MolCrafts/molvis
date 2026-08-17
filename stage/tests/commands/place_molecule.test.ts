import { Vector3 } from "@babylonjs/core";
import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../../src/app";
import { PlaceMoleculeCommand } from "../../src/commands/place_molecule";
import type { PlacementBasis } from "../../src/mode/placement_orientation";

/**
 * PlaceMoleculeCommand must center the template on the click target — the same
 * screen-plane hit used for empty-canvas atom placement (SMILES / sketch /
 * download pending molecules).
 */
describe("PlaceMoleculeCommand", () => {
  it("centers the molecule on the click target", async () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColStr("element", ["C", "O"]);
    // Two atoms centered at (1, 2, 3) before placement.
    atoms.setColF("x", new Float64Array([0, 2]));
    atoms.setColF("y", new Float64Array([2, 2]));
    atoms.setColF("z", new Float64Array([3, 3]));
    frame.insertBlock("atoms", atoms);

    const placed: Array<{ x: number; y: number; z: number; element: string }> =
      [];
    let nextAtomId = 10;

    const mockApp = {
      world: {
        sceneIndex: {
          getNextAtomId: () => nextAtomId++,
          getNextBondId: () => 100,
        },
      },
      artist: {
        async drawAtom(
          position: Vector3,
          options: { element: string; atomId?: number },
        ) {
          placed.push({
            x: position.x,
            y: position.y,
            z: position.z,
            element: options.element,
          });
          return { atomId: options.atomId ?? 0, meshId: 0 };
        },
        async drawBond() {
          return { bondId: 0, meshId: 0 };
        },
      },
    } as unknown as MolvisApp;

    const target = new Vector3(10, 20, 30);
    await new PlaceMoleculeCommand(mockApp, frame, target).do();

    expect(placed).toHaveLength(2);
    expect(placed[0].element).toBe("C");
    expect(placed[1].element).toBe("O");

    // Center of placed atoms equals the click target.
    const cx = (placed[0].x + placed[1].x) / 2;
    const cy = (placed[0].y + placed[1].y) / 2;
    const cz = (placed[0].z + placed[1].z) / 2;
    expect(cx).toBeCloseTo(10, 6);
    expect(cy).toBeCloseTo(20, 6);
    expect(cz).toBeCloseTo(30, 6);

    // Relative geometry preserved (C–O separation of 2 along x).
    expect(placed[1].x - placed[0].x).toBeCloseTo(2, 6);
    expect(placed[1].y - placed[0].y).toBeCloseTo(0, 6);
    expect(placed[1].z - placed[0].z).toBeCloseTo(0, 6);

    frame.free();
  });

  it("places a single-atom template exactly at the click (atom path)", async () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColStr("element", ["N"]);
    atoms.setColF("x", new Float64Array([100]));
    atoms.setColF("y", new Float64Array([-50]));
    atoms.setColF("z", new Float64Array([7]));
    frame.insertBlock("atoms", atoms);

    const placed: Vector3[] = [];
    const mockApp = {
      world: {
        sceneIndex: {
          getNextAtomId: () => 1,
          getNextBondId: () => 1,
        },
      },
      artist: {
        async drawAtom(position: Vector3) {
          placed.push(position.clone());
          return { atomId: 1, meshId: 0 };
        },
      },
    } as unknown as MolvisApp;

    const target = new Vector3(1.5, -2.25, 0.5);
    await new PlaceMoleculeCommand(mockApp, frame, target).do();

    expect(placed).toHaveLength(1);
    expect(placed[0].x).toBeCloseTo(1.5, 6);
    expect(placed[0].y).toBeCloseTo(-2.25, 6);
    expect(placed[0].z).toBeCloseTo(0.5, 6);

    frame.free();
  });

  it("can stamp the same Frame template at multiple targets (reuse)", async () => {
    // EditMode keeps pendingMolecule armed and reuses one Frame for each
    // canvas click; PlaceMoleculeCommand must only read the Frame.
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColStr("element", ["C", "O"]);
    atoms.setColF("x", new Float64Array([0, 2]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    frame.insertBlock("atoms", atoms);

    const placed: Array<{ x: number; y: number; z: number }> = [];
    let nextAtomId = 1;
    const mockApp = {
      world: {
        sceneIndex: {
          getNextAtomId: () => nextAtomId++,
          getNextBondId: () => 100,
        },
      },
      artist: {
        async drawAtom(position: Vector3) {
          placed.push({ x: position.x, y: position.y, z: position.z });
          return { atomId: 0, meshId: 0 };
        },
        async drawBond() {
          return { bondId: 0, meshId: 0 };
        },
      },
    } as unknown as MolvisApp;

    await new PlaceMoleculeCommand(mockApp, frame, new Vector3(0, 0, 0)).do();
    await new PlaceMoleculeCommand(mockApp, frame, new Vector3(10, 0, 0)).do();

    expect(placed).toHaveLength(4);
    // First stamp centered at origin (atoms at −1 and +1 on x).
    expect((placed[0].x + placed[1].x) / 2).toBeCloseTo(0, 6);
    // Second stamp centered at x=10.
    expect((placed[2].x + placed[3].x) / 2).toBeCloseTo(10, 6);
  });

  it("orients template axes onto a camera-facing basis", async () => {
    // Template C–O along +x, z=0. Camera looks along −X so screen right is +Z:
    // the bond should land along +Z after orientation.
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColStr("element", ["C", "O"]);
    atoms.setColF("x", new Float64Array([0, 2]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    frame.insertBlock("atoms", atoms);

    const placed: Array<{ x: number; y: number; z: number }> = [];
    let nextAtomId = 1;
    const mockApp = {
      world: {
        sceneIndex: {
          getNextAtomId: () => nextAtomId++,
          getNextBondId: () => 100,
        },
      },
      artist: {
        async drawAtom(position: Vector3) {
          placed.push({ x: position.x, y: position.y, z: position.z });
          return { atomId: 0, meshId: 0 };
        },
        async drawBond() {
          return { bondId: 0, meshId: 0 };
        },
      },
    } as unknown as MolvisApp;

    const basis: PlacementBasis = {
      right: new Vector3(0, 0, 1),
      up: new Vector3(0, 1, 0),
      out: new Vector3(1, 0, 0),
    };
    const target = new Vector3(5, 5, 5);
    await new PlaceMoleculeCommand(mockApp, frame, target, basis).do();

    expect(placed).toHaveLength(2);
    const cx = (placed[0].x + placed[1].x) / 2;
    const cy = (placed[0].y + placed[1].y) / 2;
    const cz = (placed[0].z + placed[1].z) / 2;
    expect(cx).toBeCloseTo(5, 6);
    expect(cy).toBeCloseTo(5, 6);
    expect(cz).toBeCloseTo(5, 6);

    // Relative C→O was (2,0,0) → maps to 2 * right = (0,0,2)
    expect(placed[1].x - placed[0].x).toBeCloseTo(0, 6);
    expect(placed[1].y - placed[0].y).toBeCloseTo(0, 6);
    expect(placed[1].z - placed[0].z).toBeCloseTo(2, 6);

    frame.free();
  });
});
