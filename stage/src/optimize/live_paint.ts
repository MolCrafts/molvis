/**
 * @file Mid-run optimize feedback: one worker coords beat → one canvas paint.
 *
 * @description
 * The kernels have always held live coordinates every `reportEvery` steps;
 * they now ship them as {@link OptimizeCoordsProgress} beats, and this module
 * is the only consumer that turns such a beat into pixels. It writes through
 * the edit pool (`optimize-staging-01-positions`), exactly like a drag tick:
 * positions in, one upload out.
 *
 * **Units.** `beat.coords` is packed xyz in angstrom (Å), the scene's world
 * unit — the same unit `writeAtom` expects. Nothing is scaled here.
 *
 * **Deliberate non-calls.** A live paint never calls `Pipeline.applyPipeline`,
 * `SceneIndex.registerAtomFrame` or `ImpostorState.setFrameData`, and never
 * creates an entity. The first recomputes the frame from its sources and would
 * discard the in-flight staging; the other two reset `frameOffset` and wipe the
 * edit pool, so every id resolved by the previous beat would dangle. Painting a
 * step is a buffer patch, never a scene rebuild — the run's final geometry
 * still lands once, through `StageOptimizeResultCommand`.
 *
 * Collaborators enter as narrow structural protocols (never the concrete
 * `EditPoolPositions` / `ScenePaintTick`) so the unit is testable with plain
 * fakes.
 */

import type { OptimizeCoordsProgress } from "./protocol";

/**
 * The write door {@link OptimizeLivePaint} drives: move atoms, then rebuild
 * the bonds around them. `EditPoolPositions` satisfies it as-is.
 */
export interface LivePaintWriter {
  /** Move one atom to (`x`, `y`, `z`) in Å — position only. */
  writeAtom(atomId: number, x: number, y: number, z: number): void;
  /** Rebuild every bond incident to `atomIds`, each bond once. */
  refreshBondsAround(atomIds: Iterable<number>): void;
}

/**
 * The upload door: one GPU flush per beat. `ScenePaintTick` satisfies it
 * as-is.
 */
export interface LivePaintTick {
  flush(): void;
}

/**
 * Paints one optimize run's intermediate geometry onto the live scene.
 *
 * @description
 * Construct once per run — `liveAtomCount` is a snapshot of the canvas taken
 * before the job is posted — then call {@link paint} for every coords beat.
 * The mapping is the identity: beat row `i` is logical atom id `i`, which
 * holds because the worker minimizes the very snapshot that was packed from
 * those ids, in order.
 *
 * @example
 * ```ts
 * const live = new OptimizeLivePaint(
 *   new EditPoolPositions(app.world.sceneIndex, app.styleManager),
 *   new ScenePaintTick(app.artist, app.world.sceneIndex, app.world.highlighter),
 *   working.elements.length,
 * );
 * await runOptimizeOnWorker(job, { onCoords: (beat) => live.paint(beat) });
 * ```
 */
export class OptimizeLivePaint {
  /**
   * @param positions Edit-pool write door for atom positions and bonds.
   * @param tick GPU upload for the batch this class writes.
   * @param liveAtomCount Atoms on the canvas when the run started. Rows past
   * it are the worker's own additions (capped hydrogens) and are ignored.
   */
  constructor(
    private readonly positions: LivePaintWriter,
    private readonly tick: LivePaintTick,
    private readonly liveAtomCount: number,
  ) {}

  /**
   * Write one beat's coordinates to the canvas: every atom, then one bond
   * refresh, then one upload.
   *
   * @description
   * Rows `>= liveAtomCount` are **skipped, not created**. Hydrogens the worker
   * capped exist in the beat but not on the canvas, and materializing them
   * mid-run would shift `frameOffset` and invalidate the id → row mapping every
   * later beat depends on — so the run's new entities land exactly once, in the
   * staged result command, and the live feed shows only what is already there.
   *
   * Bonds are refreshed and the frame is uploaded **once per beat**, after all
   * atom writes: `refreshBondsAround` reads endpoint positions back from atom
   * meta, and a per-atom flush would upload a half-moved molecule.
   *
   * @param beat One worker coords beat; `beat.coords` is packed xyz in Å.
   * @returns Nothing.
   * @throws Error when `beat.coords.length` disagrees with
   * `beat.atomCount * 3`. A mis-packed beat is refused whole, before any
   * write, rather than smeared across the impostor buffers.
   */
  paint(beat: OptimizeCoordsProgress): void {
    if (beat.coords.length !== beat.atomCount * 3) {
      throw new Error(
        `Optimize coords beat has ${beat.coords.length} values for ${beat.atomCount} atoms (expected ${beat.atomCount * 3})`,
      );
    }

    const rows = Math.min(beat.atomCount, this.liveAtomCount);
    const written: number[] = [];
    for (let i = 0; i < rows; i++) {
      const c = i * 3;
      this.positions.writeAtom(
        i,
        beat.coords[c],
        beat.coords[c + 1],
        beat.coords[c + 2],
      );
      written.push(i);
    }

    this.positions.refreshBondsAround(written);
    this.tick.flush();
  }
}
