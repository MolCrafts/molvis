/**
 * Structure optimize — app orchestration (main thread).
 *
 * Snapshot committed scene → **Dedicated Worker** (own molrs WASM: bonds / H /
 * typify / LBFGS) → staged edit-pool command. UI stays responsive; heavy work
 * never runs on the main thread, and the relaxed geometry lands in the working
 * tree as one undoable edit instead of overwriting the DataSource HEAD.
 */
import type { Box, Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import {
  type OptimizeStagePlan,
  StageOptimizeResultCommand,
} from "../commands/optimize_result";
import { EditPoolPositions, ScenePaintTick } from "../edit_pool_positions";
import { CELL_TILT_EPS, lammpsCellFromBox } from "../io/box_lammps";
import { shouldDrawBox } from "../io/box_presence";
import { buildFrameFromScene } from "../scene_sync";
import { BOND_TYPE_SINGLE } from "../utils/bond_order";
import { yieldForPaint } from "../utils/yield_ui";
import {
  assessOptimizeSize,
  defaultOptimizeReportEvery,
  formatOptimizeError,
  isMolrsPotential,
  type OptimizerKind,
  type OptimizeStatusCallback,
  type PotentialKind,
  resolveOptimizePair,
} from "./assess";
import { OptimizeLivePaint } from "./live_paint";
import type { OptimizeJobPayload, OptimizeJobResult } from "./protocol";
import { runOptimizeOnWorker } from "./worker_client";

/**
 * Persistent status line a staged result leaves behind, verbatim.
 *
 * Sent as `info-text-change` (not the transient `status-message`) so every
 * host — page, VSCode, Python — shows the same standing "there is an
 * uncommitted optimize result" hint until the user saves.
 */
const STAGED_HINT = "Optimized — Ctrl+S to save";

/** App-level options: {@link PotentialKind} × {@link OptimizerKind}. */
export interface OptimizeOptions {
  /** Energy model (UFF / MMFF / soft). */
  potential?: PotentialKind;
  /** Optimizer; defaults from potential (`lbfgs` for FF, `damped` for soft). */
  optimizer?: OptimizerKind;
  /** Hard cap on minimizer steps (default 200). */
  maxSteps?: number;
  /**
   * Stop once the largest per-atom force drops below this (energy units / Å,
   * the potential's own units). Default 0.05.
   */
  forceTol?: number;
  /** Atom indices (dense frame indices) fixed during minimization. */
  fixedIndices?: readonly number[];
  /**
   * When true (default for molrs FF), if the frame has no bonds block, run
   * covalent/distance bond perception before minimize so UFF/MMFF have
   * topology (CIF/mmCIF often ship heavy atoms only, no bonds).
   */
  ensureBonds?: boolean;
  /** Cap missing valence with explicit H before relaxing (default false). */
  addHydrogens?: boolean;
  /**
   * Minimizer steps between progress beats from the worker (also the L-BFGS
   * chunk size). Defaults scale with atom count so large systems report often
   * enough to look alive without drowning the UI in messages.
   */
  reportEvery?: number;
  /**
   * Polled while the worker job runs. The first `true` stops the optimizer at
   * its next checkpoint; the run still finishes normally and stages the
   * coordinates reached so far, with `cancelled: true` in the outcome.
   */
  shouldCancel?: () => boolean;
  /**
   * Minimizer step beats for a progress bar. Beats that carry only step
   * indices (status beats without energetics) pass `energy` / `maxForce` as
   * `NaN` and `converged: false` — render those as "unknown", not as zero.
   */
  onProgress?: (info: {
    step: number;
    maxSteps: number;
    energy: number;
    maxForce: number;
    converged: boolean;
  }) => void;
  /** Status-bar beats: snapshot / prepare / minimize / finalize. */
  onStatus?: OptimizeStatusCallback;
}

/**
 * What one {@link runOptimize} call did. Returned only after the result has
 * been staged into the working tree, so the numbers describe the geometry now
 * on the canvas — uncommitted until the user saves.
 */
export interface OptimizeOutcome {
  /** Minimizer steps taken. */
  steps: number;
  /**
   * Final potential energy and largest per-atom force, in the potential's own
   * energy units (energy units / Å for the force) — comparable within one run,
   * not across potentials.
   */
  energy: number;
  maxForce: number;
  /** True when `maxForce` fell below `forceTol` before `maxSteps` ran out. */
  converged: boolean;
  /**
   * True when `options.shouldCancel` stopped the run. The coordinates reached
   * so far are still staged — a cancel is a stop, not an undo.
   */
  cancelled: boolean;
  /** Atoms in the staged result (input atoms + `hydrogensAdded`). */
  atomCount: number;
  /** How many atom indices the caller asked to hold fixed. */
  fixedCount: number;
  /** Hydrogens the worker added to cap missing valences (0 unless requested). */
  hydrogensAdded: number;
  /** The pair that ran, after defaults were resolved. */
  potential: PotentialKind;
  optimizer: OptimizerKind;
}

/**
 * Thrown by {@link runOptimize} when the scene has uncommitted canvas edits.
 *
 * Optimize reads the committed structure (the DataSource HEAD), so running it
 * on a dirty scene would silently discard the pending edits. The UI is
 * expected to catch this, offer commit / discard, and retry — recovery is a
 * product decision, never a silent overwrite. Carries a stable
 * `code: "UNSAVED_SCENE"` so hosts can branch without matching on the message.
 */
export class UnsavedSceneError extends Error {
  readonly code = "UNSAVED_SCENE" as const;
  constructor(message = "Scene has unsaved edits. Commit before optimizing.") {
    super(message);
    this.name = "UnsavedSceneError";
  }
}

/**
 * A simulation cell as plain numbers — no molrs handle.
 *
 * Captured once while the source Frame's Box is in hand, so the triclinic gate
 * and the job payload read numbers instead of carrying a WASM handle across the
 * worker round trip.
 */
interface CellDescription {
  /** Edge lengths `[lx, ly, lz]` (Å). */
  readonly lengths: readonly [number, number, number];
  /** Cell origin `[ox, oy, oz]` (Å). */
  readonly origin: readonly [number, number, number];
  /** LAMMPS tilts `[xy, xz, yz]` (Å). Any non-zero entry ⇒ triclinic. */
  readonly tilts: readonly [number, number, number];
  /** Real cell ({@link shouldDrawBox}): usable for PBC / minimum image. */
  readonly periodic: boolean;
}

/**
 * Owned, main-thread snapshot of the committed scene, ready to pack as a job.
 *
 * Plain numbers only — no molrs handle survives this call, because the result
 * is staged onto the live scene rather than written back into a Frame.
 */
interface WorkingSnapshot {
  /** Source cell, or undefined for a free-boundary structure. */
  cell?: CellDescription;
  /**
   * Pre-optimize coordinates (Å). These buffers go into the job payload and are
   * **transferred** to the worker, so they are detached once the job is posted —
   * read the result afterwards, never these.
   */
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  elements: string[];
  bonds: Array<[number, number]>;
  /** molrs `bond_type` per entry of {@link bonds}; single when the source had none. */
  bondTypes: number[];
}

/**
 * Read a Box into LAMMPS lx/ly/lz + tilts. Does not take ownership of `box`.
 *
 * Per-axis periodicity is deliberately not carried: nothing downstream of the
 * staged result reads it, and `lammpsCellFromBox(box).pbc` re-derives it if a
 * future path needs it.
 */
function describeCell(box: Box): CellDescription {
  const cell = lammpsCellFromBox(box);
  return {
    lengths: cell.lengths,
    origin: cell.origin,
    tilts: cell.tilts,
    periodic: shouldDrawBox(box),
  };
}

/** True when the cell carries a tilt the ortho-only job payload cannot express. */
function isTriclinic(cell: CellDescription): boolean {
  return cell.tilts.some((t) => Math.abs(t) > CELL_TILT_EPS);
}

/**
 * Snapshot committed scene → owned, handle-free working copy of atoms/bonds.
 * Prefers system.frame (DataSource HEAD). Caller must have committed when dirty.
 */
function snapshotWorkingFrame(app: MolvisApp): WorkingSnapshot {
  const head = app.system.frame;
  const headAtoms = head?.getBlock("atoms")?.nrows() ?? 0;
  if (headAtoms > 0) {
    // Copy out of HEAD — do not free system.frame.
    return materializeWorkingFromSource(head);
  }

  // Clean tree but empty HEAD: last resort from scene index (should be rare).
  const source = buildFrameFromScene(app.world.sceneIndex, {
    sourceFrame: head,
    markSaved: false,
  });
  try {
    return materializeWorkingFromSource(source);
  } finally {
    source.free();
  }
}

/** Copy `source` (cell, coordinates, elements, bonds) into an owned snapshot. */
function materializeWorkingFromSource(source: Frame): WorkingSnapshot {
  // Read the cell before taking Block borrows. The handle is only read from —
  // never freed, since freeing a box handle corrupts the frame's shared data
  // on later reads (see `analysis/utils.ts` `estimateRMax`).
  const sourceBox = source.box;
  const cell = sourceBox ? describeCell(sourceBox) : undefined;

  const atoms = source.getBlock("atoms");
  const bondBlock = source.getBlock("bonds");
  if (!atoms || atoms.nrows() === 0) {
    throw new Error("No atoms to optimize");
  }
  const n = atoms.nrows();
  const xSrc = atoms.copyColF("x");
  const ySrc = atoms.copyColF("y");
  const zSrc = atoms.copyColF("z");
  if (!xSrc || !ySrc || !zSrc) {
    throw new Error("Atoms are missing x/y/z coordinates");
  }
  const elements =
    atoms.copyColStr("element") ?? Array.from({ length: n }, () => "C");
  const x = new Float64Array(xSrc);
  const y = new Float64Array(ySrc);
  const z = new Float64Array(zSrc);

  const bonds: Array<[number, number]> = [];
  const bondTypes: number[] = [];
  if (bondBlock && bondBlock.nrows() > 0) {
    const iCol =
      bondBlock.viewColU32("atomi") ?? bondBlock.viewColU32("i") ?? null;
    const jCol =
      bondBlock.viewColU32("atomj") ?? bondBlock.viewColU32("j") ?? null;
    if (iCol && jCol) {
      const typeCol = bondBlock.dtype("bond_type")
        ? bondBlock.viewColU32("bond_type")
        : undefined;
      for (let b = 0; b < bondBlock.nrows(); b++) {
        bonds.push([iCol[b], jCol[b]]);
        bondTypes.push(typeCol?.[b] ?? BOND_TYPE_SINGLE);
      }
    }
  }

  return { cell, x, y, z, elements, bonds, bondTypes };
}

/** Pack a snapshot + resolved settings into the handle-free worker payload. */
function workingToJob(
  working: WorkingSnapshot,
  opts: {
    potential: PotentialKind;
    optimizer: OptimizerKind;
    maxSteps: number;
    forceTol: number;
    fixedIndices: readonly number[];
    ensureBonds: boolean;
    addHydrogens: boolean;
    reportEvery: number;
  },
): OptimizeJobPayload {
  const nB = working.bonds.length;
  const bondI = new Uint32Array(nB);
  const bondJ = new Uint32Array(nB);
  // Bond orders ride along: without them the worker rebuilds every bond as
  // single (`job_runner.ts` `frameFromJob`) and UFF/MMFF relax a double bond
  // with single-bond parameters.
  const bondType = Uint32Array.from(working.bondTypes);
  for (let i = 0; i < nB; i++) {
    bondI[i] = working.bonds[i][0];
    bondJ[i] = working.bonds[i][1];
  }
  const job: OptimizeJobPayload = {
    x: working.x,
    y: working.y,
    z: working.z,
    elements: working.elements,
    bondI,
    bondJ,
    bondType,
    potential: opts.potential,
    optimizer: opts.optimizer,
    maxSteps: opts.maxSteps,
    forceTol: opts.forceTol,
    fixedIndices: Uint32Array.from(opts.fixedIndices),
    ensureBonds: opts.ensureBonds,
    addHydrogens: opts.addHydrogens,
    reportEvery: opts.reportEvery,
  };
  // Only real cells go to the worker as PBC; non-PBC placeholders stay free-boundary.
  const cell = working.cell;
  if (cell?.periodic) {
    job.boxLengths = Float64Array.from(cell.lengths);
    job.boxOrigin = Float64Array.from(cell.origin);
  }
  return job;
}

/**
 * Put one worker result into the working tree as a single undoable edit.
 *
 * `commandManager.execute` is the only ingress that makes it reversible: the
 * manager keeps the instance, while running `do()` directly (or through the
 * `@command` registry) would move the atoms with no way back. The standing
 * `info-text-change` line follows, because the geometry stays uncommitted
 * until the user saves.
 *
 * @param app Live app whose edit pool receives the geometry.
 * @param result Finished worker job; coordinates in Å.
 * @param baseAtomCount Atoms on the canvas before the run — rows past it are
 * the worker's additions and get new ids.
 * @throws Error when the result's element list disagrees with its atom count,
 * which would map rows onto the wrong atoms.
 */
async function stageOptimizeResult(
  app: MolvisApp,
  result: OptimizeJobResult,
  baseAtomCount: number,
): Promise<void> {
  const elements = result.elements ?? [];
  if (elements.length !== result.atomCount) {
    throw new Error(
      `Optimize result size mismatch: ${elements.length} elements vs ${result.atomCount} atoms`,
    );
  }
  const plan: OptimizeStagePlan = {
    x: result.x,
    y: result.y,
    z: result.z,
    elements,
    bondI: result.bondI ?? new Uint32Array(0),
    bondJ: result.bondJ ?? new Uint32Array(0),
    bondType: result.bondType,
    baseAtomCount,
  };

  await app.commandManager.execute(new StageOptimizeResultCommand(app, plan));
  app.events.emit("info-text-change", STAGED_HINT);
}

/**
 * Relax the current **committed** scene geometry and stage the result.
 *
 * Heavy work (bond perception, typify, NeighborList, L-BFGS) runs in a
 * **Dedicated Worker** with its own molrs instance. The main thread snapshots
 * the structure, posts the job, forwards progress, repaints the canvas from
 * each reported step, and stages the finished geometry once.
 *
 * **Staged, not published.** The result lands in the live edit pool as one
 * undoable {@link StageOptimizeResultCommand}: the canvas shows the relaxed
 * geometry, the scene goes dirty, and a persistent `info-text-change` line
 * tells the user to save. The DataSource HEAD, its trajectory and the pipeline
 * are never touched — Ctrl+S → `commitScene` is what writes the geometry back,
 * which is also where the source frame's non-coordinate columns (charge,
 * `mol_id`, residue fields, …) and its cell are carried over. Undo restores the
 * pre-optimize coordinates; a run that throws leaves the scene exactly as it
 * was. Because nothing is written to a DataSource, a file-backed structure is
 * optimizable too.
 *
 * **UI contract (main thread stays free to paint):**
 * - `options.onStatus` — every worker progress beat (prep + minimize lines + %)
 *   → page wires this to `status-message` / status bar
 * - `options.onProgress` — minimize step beats → panel progress bar
 * - During the job: each step's coordinates repaint the atoms already on the
 *   canvas through the edit pool ({@link OptimizeLivePaint}) — position-only,
 *   no pipeline pass, no new entities
 * - After the job: build the plan → `commandManager.execute` → canvas updates
 *   from the edit pool, with no pipeline pass
 *
 * Cancelling via `options.shouldCancel` is not an abort: the last coordinates
 * the optimizer reached are still staged, and the outcome reports
 * `cancelled: true`.
 *
 * @throws UnsavedSceneError when the scene has uncommitted canvas edits —
 *   commit first
 * @throws Error when `potential` and `optimizer` do not pair (see
 *   {@link resolveOptimizePair}); when the scene has no atoms or no x/y/z; when
 *   the system is too large for the chosen potential (size assessment blocks
 *   it, before and again after hydrogens are added); when the cell is
 *   **triclinic**, because the job payload carries edge lengths only and a
 *   tilted cell would be optimized against the wrong periodicity; when the
 *   worker or its job fails; and when the result's element list disagrees with
 *   its atom count
 */
export async function runOptimize(
  app: MolvisApp,
  options: OptimizeOptions = {},
): Promise<OptimizeOutcome> {
  if (app.world.sceneIndex.hasUnsavedChanges) {
    throw new UnsavedSceneError();
  }

  const pair = resolveOptimizePair(
    options.potential ?? "uff",
    options.optimizer,
  );
  const { potential, optimizer } = pair;
  const maxSteps = options.maxSteps ?? 200;
  const forceTol = options.forceTol ?? 0.05;
  const fixedIndices = options.fixedIndices ?? [];
  const wantHydrogens = options.addHydrogens === true;
  const wantEnsureBonds =
    options.ensureBonds !== false && isMolrsPotential(potential);
  const status = options.onStatus;

  status?.({
    phase: "snapshot",
    message: "Reading structure…",
  });
  await yieldForPaint();

  let working: WorkingSnapshot;
  try {
    working = snapshotWorkingFrame(app);
  } catch (err) {
    throw new Error(formatOptimizeError(err));
  }

  // Atoms already on the canvas: rows past this one are the worker's additions.
  const baseAtomCount = working.elements.length;

  try {
    status?.({
      phase: "snapshot",
      message: `${working.elements.length.toLocaleString()} atoms · ${working.bonds.length.toLocaleString()} bonds`,
    });
    await yieldForPaint();

    const risk = assessOptimizeSize(working.elements.length, potential, {
      bondCount: working.bonds.length,
    });
    if (risk.level === "hard_block" || risk.level === "soft_block") {
      throw new Error(risk.message);
    }

    if (working.cell && isTriclinic(working.cell)) {
      // The job payload carries edge lengths only, so a tilted cell would ship
      // as a squared one and the minimizer would use the wrong periodicity.
      // Refuse rather than relax against a cell the user never asked for.
      throw new Error(
        "Optimize does not support triclinic cells yet " +
          `(tilts xy/xz/yz = ${working.cell.tilts.map((t) => t.toFixed(3)).join(", ")} Å). ` +
          "Convert the cell to orthorhombic first.",
      );
    }

    const reportEvery =
      options.reportEvery ??
      defaultOptimizeReportEvery(working.elements.length, potential);

    const job = workingToJob(working, {
      potential,
      optimizer,
      maxSteps,
      forceTol,
      fixedIndices,
      ensureBonds: wantEnsureBonds && working.bonds.length === 0,
      addHydrogens: wantHydrogens,
      reportEvery,
    });

    status?.({
      phase: "pipeline",
      message: "Starting optimization…",
    });
    await yieldForPaint();

    // Live feed: every reported step repaints the atoms already on the canvas
    // through the same edit-pool door the staged result uses, so a long run
    // shows the structure relaxing instead of a frozen scene. Rows the worker
    // adds mid-run (capped hydrogens) are ignored until the result is staged.
    const live = new OptimizeLivePaint(
      new EditPoolPositions(app.world.sceneIndex, app.styleManager),
      new ScenePaintTick(
        app.artist,
        app.world.sceneIndex,
        app.world.highlighter,
      ),
      baseAtomCount,
    );

    const result = await runOptimizeOnWorker(job, {
      onStatus: (s) => {
        // Status bar + panel: message and 0–100 progress from worker.
        status?.({
          phase: s.phase,
          message: s.message,
          progress: s.progress,
          step: s.step,
          maxSteps: s.maxSteps,
        });
        // If the beat also carries step indices, keep onProgress in sync.
        if (
          s.step !== undefined &&
          s.maxSteps !== undefined &&
          s.maxSteps > 0
        ) {
          options.onProgress?.({
            step: s.step,
            maxSteps: s.maxSteps,
            energy: Number.NaN,
            maxForce: Number.NaN,
            converged: false,
          });
        }
      },
      onStep: (info) => {
        options.onProgress?.(info);
      },
      onCoords: (beat) => {
        live.paint(beat);
      },
      shouldCancel: options.shouldCancel,
    });

    status?.({
      phase: "finalize",
      message: result.cancelled
        ? "Applying last coordinates…"
        : "Updating view…",
    });
    await yieldForPaint();

    await stageOptimizeResult(app, result, baseAtomCount);

    return {
      steps: result.steps,
      energy: result.energy,
      maxForce: result.maxForce,
      converged: result.converged,
      cancelled: result.cancelled,
      atomCount: result.atomCount,
      fixedCount: fixedIndices.length,
      hydrogensAdded: result.hydrogensAdded,
      potential: result.potential,
      optimizer: result.optimizer,
    };
  } catch (err) {
    throw err instanceof Error ? err : new Error(formatOptimizeError(err));
  }
}
