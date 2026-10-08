import { Vector3 } from "@babylonjs/core";
import { toRowIndex } from "@molcrafts/molvis-core";
import {
  assignKekuleBondOrders,
  type Frame,
} from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import { viewAtomCoords } from "../io/atom_coords";
import {
  identityPlacementBasis,
  orientLocalOffset,
  type PlacementBasis,
} from "../mode/placement_orientation";
import { BOND_TYPE_SINGLE } from "../utils/bond_order";
import { Command } from "./base";
import { CompositeCommand } from "./composite";
import { DrawAtomCommand, DrawBondCommand } from "./draw";

/**
 * Extracts atom and bond data from a Frame, orients relative offsets onto a
 * placement basis (default: identity; edit mode passes camera-facing axes),
 * centers on the click target, and executes batch DrawAtom + DrawBond.
 * Undo removes all placed atoms/bonds as a single atomic action.
 *
 * Read-only on the caller's Frame: stamps go through molrs
 * `assignKekuleBondOrders` (new handle, freed after column snapshot) so
 * aromatic bonds carry localized `bond_number` without mutating the template.
 * Ownership of the constructor Frame stays with the caller.
 */
export class PlaceMoleculeCommand extends Command<void> {
  private composite: CompositeCommand | null = null;
  private readonly basis: PlacementBasis;

  constructor(
    app: MolvisApp,
    private frame: Frame,
    private target: Vector3,
    /**
     * Camera-facing basis for template axes. When omitted, template axes map
     * to world axes (legacy / tests). Edit mode always supplies
     * {@link cameraFacingBasis}.
     */
    basis?: PlacementBasis,
  ) {
    super(app);
    // Clone so later camera moves cannot mutate an in-flight command.
    const src = basis ?? identityPlacementBasis();
    this.basis = {
      right: src.right.clone(),
      up: src.up.clone(),
      out: src.out.clone(),
    };
  }

  async do(): Promise<void> {
    // Redo path: re-execute the existing composite
    if (this.composite) {
      await this.composite.do();
      return;
    }

    // A new Frame; free it when we are done reading.
    const prepared = assignKekuleBondOrders(this.frame);
    try {
      await this.buildAndRunFrom(prepared);
    } finally {
      prepared.free();
    }
  }

  private async buildAndRunFrom(frame: Frame): Promise<void> {
    if (!frame.has("atoms")) return;
    const atomBlock = frame.get("atoms");

    const nAtoms = atomBlock.nRows;
    if (nAtoms === 0) return;

    // Snapshot positions into JS-owned buffers before any other WASM column
    // read (copy can reallocate and invalidate view views).
    const coords = viewAtomCoords(atomBlock);
    if (!coords) {
      throw new Error("Frame atoms are missing x/y/z and xu/yu/zu coordinates");
    }
    const xs = Float64Array.from(coords.x);
    const ys = Float64Array.from(coords.y);
    const zs = Float64Array.from(coords.z);

    const elements = atomBlock.copy("element") as string[];
    if (elements.length < nAtoms) {
      throw new Error(
        "Frame atoms are missing element column (required to place)",
      );
    }

    // Compute molecule center so the template is centered on the click target
    // (same click projection as a single DrawAtomCommand).
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < nAtoms; i++) {
      cx += xs[i];
      cy += ys[i];
      cz += zs[i];
    }
    cx /= nAtoms;
    cy /= nAtoms;
    cz /= nAtoms;

    // Oriented world positions: center → target, template axes → placement basis.
    const worldPositions: Vector3[] = [];
    for (let i = 0; i < nAtoms; i++) {
      const oriented = orientLocalOffset(
        xs[i] - cx,
        ys[i] - cy,
        zs[i] - cz,
        this.basis,
      );
      worldPositions.push(
        new Vector3(
          this.target.x + oriented.x,
          this.target.y + oriented.y,
          this.target.z + oriented.z,
        ),
      );
    }

    // Pre-allocate contiguous atom and bond IDs
    const baseAtomId = this.app.world.sceneIndex.getNextAtomId();
    const baseBondId = this.app.world.sceneIndex.getNextBondId();

    // Build atom commands
    const atomCommands: Command<unknown>[] = [];
    for (let i = 0; i < nAtoms; i++) {
      atomCommands.push(
        new DrawAtomCommand(this.app, worldPositions[i], {
          element: elements[i],
          atomId: baseAtomId + i,
        }),
      );
    }

    // Build bond commands with pre-assigned IDs
    const bondCommands: Command<unknown>[] = [];
    const bondBlock = frame.has("bonds") ? frame.get("bonds") : undefined;

    if (bondBlock && bondBlock.nRows > 0) {
      const nBonds = bondBlock.nRows;
      const is = bondBlock.copy("atomi") as BigUint64Array;
      const js = bondBlock.copy("atomj") as BigUint64Array;

      const typeCol =
        bondBlock.has("bond_type") && bondBlock.dtype("bond_type") === "uint"
          ? (bondBlock.copy("bond_type") as BigUint64Array)
          : undefined;
      const numberCol =
        bondBlock.has("bond_number") &&
        bondBlock.dtype("bond_number") === "uint"
          ? (bondBlock.copy("bond_number") as BigUint64Array)
          : undefined;

      for (let b = 0; b < nBonds; b++) {
        const ai = toRowIndex(is[b]);
        const aj = toRowIndex(js[b]);
        if (ai >= nAtoms || aj >= nAtoms) continue;

        const bondType = typeCol ? toRowIndex(typeCol[b]) : BOND_TYPE_SINGLE;
        const bondNumber = numberCol
          ? toRowIndex(numberCol[b])
          : bondType >= BOND_TYPE_SINGLE && bondType <= 3
            ? bondType
            : 0;

        bondCommands.push(
          new DrawBondCommand(
            this.app,
            worldPositions[ai],
            worldPositions[aj],
            {
              bondType,
              bondNumber,
              atomId1: baseAtomId + ai,
              atomId2: baseAtomId + aj,
              bondId: baseBondId + b,
            },
          ),
        );
      }
    }

    this.composite = new CompositeCommand(this.app, [
      ...atomCommands,
      ...bondCommands,
    ]);
    await this.composite.do();
  }

  async undo(): Promise<Command> {
    if (this.composite) {
      await this.composite.undo();
    }
    return this;
  }
}
