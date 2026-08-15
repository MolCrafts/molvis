import { Vector3 } from "@babylonjs/core";
import type { MolvisApp } from "../app";
import { EditPoolPositions, ScenePaintTick } from "../edit_pool_positions";
import { BOND_TYPE_SINGLE, BOND_TYPE_TRIPLE } from "../utils/bond_order";
import { Command } from "./base";
import { CompositeCommand } from "./composite";
import { DrawAtomCommand, DrawBondCommand } from "./draw";

/**
 * @file Staging an optimize result as one undoable edit-pool command.
 *
 * @description
 * A finished minimization is a **proposal**, not a publish: its coordinates
 * (plus any hydrogens the worker capped valences with) land in the live edit
 * pool as a single reversible action, the scene goes dirty, and Ctrl+S →
 * `commitScene` is what writes them back. Nothing here touches the DataSource
 * HEAD, the trajectory, or the pipeline.
 *
 * **Units.** Every coordinate in {@link OptimizeStagePlan} and every position
 * this module writes is in angstrom (Å), the scene's world unit — the same
 * numbers the worker returned, unscaled.
 *
 * **Execution-model contract.** {@link StageOptimizeResultCommand} deliberately
 * carries **no `@command` decorator**: registry / RPC execution runs `do()` and
 * discards the instance, so a decorated command can never be undone
 * (`base.ts` `command()`). The only legal ingress is
 * `app.commandManager.execute(new StageOptimizeResultCommand(...))`, which
 * keeps the instance and calls `undo()` on rollback. For the same reason the
 * class is absent from `REGISTERED_COMMAND_CLASSES` and is not re-exported
 * from `commands/index.ts`.
 *
 * **Deliberate non-calls.** Never `MolvisApp.applyPipeline` (recomputes the
 * frame from its sources and discards the staged edit), never
 * `SceneIndex.registerAtomFrame` / `ImpostorState.setFrameData` (reset
 * `frameOffset` and wipe the edit pool), never
 * `SceneIndex.promoteFrameToEditPool` (frame-segment rows are addressed by
 * identity; new entities are created through `DrawAtomCommand` /
 * `DrawBondCommand`). Staging is a buffer patch, never a scene rebuild.
 */

/** A position on the live scene (Å). */
interface StagedPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * The optimize result as plain, transferable data — no molrs handle.
 *
 * @description
 * Row order is the round trip's: dense row `r` of the result is logical atom id
 * `r` for `r < baseAtomCount`. Rows past that are atoms the worker added, and
 * get freshly allocated ids when the plan is staged.
 */
export interface OptimizeStagePlan {
  /** Relaxed x coordinates (Å), one entry per row of {@link elements}. */
  readonly x: Float64Array;
  /** Relaxed y coordinates (Å), one entry per row of {@link elements}. */
  readonly y: Float64Array;
  /** Relaxed z coordinates (Å), one entry per row of {@link elements}. */
  readonly z: Float64Array;
  /** Element symbol per row; its length is the post-optimize atom count. */
  readonly elements: readonly string[];
  /** Bond endpoints as dense row indices into {@link elements}. */
  readonly bondI: Uint32Array;
  readonly bondJ: Uint32Array;
  /** molrs `bond_type` per bond; single when omitted. */
  readonly bondType?: Uint32Array;
  /** Atoms already on the canvas before the run — rows `0..baseAtomCount-1`. */
  readonly baseAtomCount: number;
}

/**
 * Stages an optimize result into the live edit pool as one undoable action.
 *
 * @description
 * `do()` captures the on-screen positions **when it runs** (not at
 * construction, so a scene that moved in between still undoes to what the user
 * saw), writes the planned coordinates through {@link EditPoolPositions}, adds
 * the worker's new atoms and their new bonds as one {@link CompositeCommand},
 * and paints once. `undo()` is its mirror: drop the added entities, write the
 * captured positions back, paint once. A second `do()` is the manager's redo
 * path and replays the stored composite, so the added atoms keep their ids
 * instead of piling up.
 *
 * Executing it is the caller's job — see the file docstring's execution-model
 * contract.
 *
 * @example
 * ```ts
 * await app.commandManager.execute(
 *   new StageOptimizeResultCommand(app, {
 *     x, y, z, elements, bondI, bondJ, baseAtomCount,
 *   }),
 * );
 * ```
 */
export class StageOptimizeResultCommand extends Command<void> {
  /** Added atoms / bonds, kept for undo and replayed on redo. */
  private composite: CompositeCommand | null = null;
  /** Pre-stage positions (Å) by atom id; `null` until `do()` has captured. */
  private previousPositions: Map<number, StagedPosition> | null = null;

  /**
   * @param app Live app whose scene index, artist and styles are written.
   * @param plan Optimize result to stage (Å); read-only, never mutated.
   */
  constructor(
    app: MolvisApp,
    private readonly plan: OptimizeStagePlan,
  ) {
    super(app);
  }

  /**
   * Stage the plan: write coordinates, add new entities, paint once.
   *
   * @description
   * Order is semantic. The snapshot is taken first (an unexecuted command has
   * nothing to restore), coordinates are written before growth so the new
   * bonds attach to relaxed endpoints, and the single
   * {@link ScenePaintTick.flush} runs last — it uploads the buffers, flags the
   * scene unsaved and rebuilds the highlight in one go, per action rather than
   * per atom.
   *
   * @returns Nothing; the staged geometry is readable from the scene index.
   * @throws Error when the plan's arrays disagree with each other (see
   * {@link OptimizeStagePlan}).
   */
  async do(): Promise<void> {
    this.assertPlanIsConsistent();

    if (!this.previousPositions) {
      this.previousPositions = this.capturePositions();
    }

    const positions = this.editPool();
    const { baseAtomCount, x, y, z } = this.plan;
    for (let row = 0; row < baseAtomCount; row++) {
      positions.writeAtom(row, x[row], y[row], z[row]);
    }

    if (this.composite) {
      // Redo: the added atoms/bonds already have their ids — replay, never
      // re-allocate, or every redo would grow the molecule.
      await this.composite.do();
    } else if (this.plan.elements.length > baseAtomCount) {
      this.composite = this.buildAdditions();
      await this.composite.do();
    }

    positions.refreshBondsAround(this.baseAtomIds());
    this.paintTick().flush();
  }

  /**
   * Undo the staging: remove what was added, restore the captured positions.
   *
   * @description
   * Mirror of {@link do} — additions go first (so the restored coordinates are
   * written onto the atoms that remain), then one paint. The captured
   * positions survive, so the manager can redo.
   *
   * @returns This command, per the history's contract.
   * @throws Error when the command has not been executed — there is no
   * snapshot to restore and silently doing nothing would hide the bug.
   */
  async undo(): Promise<Command> {
    const previous = this.previousPositions;
    if (!previous) {
      throw new Error(
        "StageOptimizeResultCommand has not been executed — nothing to undo.",
      );
    }

    if (this.composite) await this.composite.undo();

    const positions = this.editPool();
    for (const [atomId, position] of previous) {
      positions.writeAtom(atomId, position.x, position.y, position.z);
    }
    positions.refreshBondsAround(previous.keys());
    this.paintTick().flush();

    return this;
  }

  /** Reject a plan whose arrays disagree, before a single atom has moved. */
  private assertPlanIsConsistent(): void {
    const { x, y, z, elements, bondI, bondJ, baseAtomCount } = this.plan;
    const rows = elements.length;
    if (x.length < rows || y.length < rows || z.length < rows) {
      throw new Error(
        `StageOptimizeResultCommand: ${rows} elements but ` +
          `${x.length}/${y.length}/${z.length} x/y/z coordinates.`,
      );
    }
    if (baseAtomCount > rows) {
      throw new Error(
        `StageOptimizeResultCommand: ${baseAtomCount} base atoms exceed the ` +
          `${rows} atoms in the result.`,
      );
    }
    if (bondI.length !== bondJ.length) {
      throw new Error(
        `StageOptimizeResultCommand: ${bondI.length} bond i endpoints but ` +
          `${bondJ.length} bond j endpoints.`,
      );
    }
    for (let b = 0; b < bondI.length; b++) {
      if (bondI[b] >= rows || bondJ[b] >= rows) {
        throw new Error(
          `StageOptimizeResultCommand: bond ${b} references atom row ` +
            `${Math.max(bondI[b], bondJ[b])} of ${rows}.`,
        );
      }
    }
  }

  /** Logical ids of the atoms already on the canvas (rows are identity ids). */
  private baseAtomIds(): number[] {
    return Array.from({ length: this.plan.baseAtomCount }, (_, i) => i);
  }

  /** On-screen positions (Å) of the base atoms, copied out of their meta. */
  private capturePositions(): Map<number, StagedPosition> {
    const atoms = this.app.world.sceneIndex.metaRegistry.atoms;
    const captured = new Map<number, StagedPosition>();
    for (const atomId of this.baseAtomIds()) {
      const meta = atoms.getMeta(atomId);
      if (!meta) continue;
      captured.set(atomId, { ...meta.position });
    }
    return captured;
  }

  /**
   * Atoms the worker added, plus the bonds that touch them, as one composite.
   *
   * @description
   * Ids are pre-allocated contiguously before any draw runs
   * ({@link PlaceMoleculeCommand}'s shape), so undo/redo address the same
   * entities. Bonds whose endpoints are both base atoms are skipped: that
   * topology is already on the canvas and re-drawing it would double every
   * bond of the molecule.
   */
  private buildAdditions(): CompositeCommand {
    const sceneIndex = this.app.world.sceneIndex;
    const firstAddedAtomId = sceneIndex.getNextAtomId();
    const firstAddedBondId = sceneIndex.getNextBondId();
    const { baseAtomCount, elements, x, y, z, bondI, bondJ, bondType } =
      this.plan;

    const atomIdOfRow = (row: number): number =>
      row < baseAtomCount ? row : firstAddedAtomId + (row - baseAtomCount);
    const positionOfRow = (row: number): Vector3 =>
      new Vector3(x[row], y[row], z[row]);

    const commands: Command<unknown>[] = [];
    for (let row = baseAtomCount; row < elements.length; row++) {
      commands.push(
        new DrawAtomCommand(this.app, positionOfRow(row), {
          element: elements[row],
          atomId: atomIdOfRow(row),
        }),
      );
    }

    let nextBondId = firstAddedBondId;
    for (let b = 0; b < bondI.length; b++) {
      const rowI = bondI[b];
      const rowJ = bondJ[b];
      if (rowI < baseAtomCount && rowJ < baseAtomCount) continue;
      const type = bondType?.[b] ?? BOND_TYPE_SINGLE;
      commands.push(
        new DrawBondCommand(
          this.app,
          positionOfRow(rowI),
          positionOfRow(rowJ),
          {
            bondType: type,
            // Lewis integer for 1|2|3; aromatic has no Kekulé phase here, and
            // the artist derives the stick count from these two.
            bondNumber: type <= BOND_TYPE_TRIPLE ? type : 0,
            atomId1: atomIdOfRow(rowI),
            atomId2: atomIdOfRow(rowJ),
            bondId: nextBondId++,
          },
        ),
      );
    }

    return new CompositeCommand(this.app, commands);
  }

  /** Ring 01's only position write door, bound to the live scene. */
  private editPool(): EditPoolPositions {
    return new EditPoolPositions(
      this.app.world.sceneIndex,
      this.app.styleManager,
    );
  }

  /** One GPU upload + dirty flag + highlight rebuild for a whole action. */
  private paintTick(): ScenePaintTick {
    return new ScenePaintTick(
      this.app.artist,
      this.app.world.sceneIndex,
      this.app.world.highlighter,
    );
  }
}
