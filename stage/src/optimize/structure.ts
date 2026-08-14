/**
 * Structure optimize — app orchestration (main thread).
 *
 * Snapshot committed scene → **Dedicated Worker** (own molrs WASM: bonds / H /
 * typify / LBFGS) → pipeline publish. UI stays responsive; heavy work never
 * runs on the main thread.
 */
import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import { CELL_TILT_EPS, lammpsCellFromBox } from "../io/box_lammps";
import { shouldDrawBox } from "../io/box_presence";
import { applyAutoAttach } from "../pipeline/auto_attach";
import { type DataSource, MemoryDataSource } from "../pipeline/data_source";
import { primaryDataSource as headPrimary } from "../pipeline/empty_scene";
import { ModifierCapability } from "../pipeline/modifier";
import { buildFrameFromScene } from "../scene_sync";
import {
  BOND_TYPE_SINGLE,
  displayBondOrder,
  setBondTopology,
} from "../utils/bond_order";
import { DType } from "../utils/dtype";
import { safeFree, yieldForPaint } from "../utils/yield_ui";
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
import type { OptimizeJobPayload, OptimizeJobResult } from "./protocol";
import { runOptimizeOnWorker } from "./worker_client";

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
   * its next checkpoint; the run still finishes normally and publishes the
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
 * been published to the pipeline and drawn, so the numbers describe the
 * geometry now on screen.
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
   * so far are still published — a cancel is a stop, not an undo.
   */
  cancelled: boolean;
  /** Atoms in the published frame (input atoms + `hydrogensAdded`). */
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
 * Wait until Babylon has finished one engine frame.
 * Same clock family as camera preview (`onAfterRenderObservable`).
 */
function waitForNextEngineFrame(app: MolvisApp): Promise<void> {
  const scene = app.world.scene;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    scene.onAfterRenderObservable.addOnce(() => finish());
    // Safety: if the engine is paused, don't hang forever.
    setTimeout(finish, 50);
  });
}

/**
 * A simulation cell as plain numbers — no molrs handle.
 *
 * Captured once while the source Frame's Box is in hand, so both the job
 * payload and the writeback read numbers instead of carrying a WASM handle
 * across the worker round trip.
 */
interface CellDescription {
  /** Edge lengths `[lx, ly, lz]` (Å). */
  readonly lengths: readonly [number, number, number];
  /** Cell origin `[ox, oy, oz]` (Å). */
  readonly origin: readonly [number, number, number];
  /** Per-axis periodicity `[px, py, pz]`. */
  readonly pbc: readonly [boolean, boolean, boolean];
  /** LAMMPS tilts `[xy, xz, yz]` (Å). Any non-zero entry ⇒ triclinic. */
  readonly tilts: readonly [number, number, number];
  /** Real cell ({@link shouldDrawBox}): usable for PBC / minimum image. */
  readonly periodic: boolean;
}

/** Owned, main-thread snapshot of the committed scene, ready to pack as a job. */
interface WorkingSnapshot {
  /**
   * Full copy of the source frame — every atom column, not just coordinates.
   * Stays alive until writeback: it is the template the result frame clones.
   */
  frame: Frame;
  /** Source cell, or undefined for a free-boundary structure. */
  cell?: CellDescription;
  /**
   * Pre-optimize coordinates (Å). These buffers go into the job payload and are
   * **transferred** to the worker, so they are detached once the job is posted —
   * read `frame` (or the result) afterwards, never these.
   */
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  elements: string[];
  bonds: Array<[number, number]>;
  orders: number[];
}

/** Read a Box into LAMMPS lx/ly/lz + tilts. Does not take ownership of `box`. */
function describeCell(box: Box): CellDescription {
  const cell = lammpsCellFromBox(box);
  return {
    lengths: cell.lengths,
    origin: cell.origin,
    pbc: cell.pbc,
    tilts: cell.tilts,
    periodic: shouldDrawBox(box),
  };
}

/** True when the cell carries a tilt the ortho-only job payload cannot express. */
function isTriclinic(cell: CellDescription): boolean {
  return cell.tilts.some((t) => Math.abs(t) > CELL_TILT_EPS);
}

/**
 * Rebuild the cell as a **fresh** molrs Box. `Frame.box` moves what it is
 * given, so every attach constructs its own — never re-attach a handle the
 * caller still holds.
 */
function buildCellBox(cell: CellDescription): Box {
  return Box.ortho(
    Float64Array.from(cell.lengths),
    Float64Array.from(cell.origin),
    cell.pbc[0],
    cell.pbc[1],
    cell.pbc[2],
  );
}

/**
 * Copy every column of `src` into `dst`, sized to `rows`.
 *
 * `rows` may exceed `src.nrows()` when the optimizer capped valences with
 * explicit hydrogens; the extra rows take 0 (numeric) or `""` (string) and the
 * caller overwrites the columns it owns (x/y/z/element).
 */
function cloneAtomColumns(src: Block, dst: Block, rows: number): void {
  const kept = Math.min(src.nrows(), rows);
  for (const key of src.keys() as string[]) {
    const dtype = src.dtype(key);
    if (dtype === DType.String) {
      const col = src.copyColStr(key) as string[] | undefined;
      if (!col) continue;
      const out = new Array<string>(rows).fill("");
      for (let i = 0; i < kept; i++) out[i] = col[i] ?? "";
      dst.setColStr(key, out);
    } else if (dtype === DType.F64) {
      const col = src.copyColF(key);
      if (!col) continue;
      const out = new Float64Array(rows);
      out.set(col.subarray(0, kept));
      dst.setColF(key, out);
    } else if (dtype === DType.U32) {
      const col = src.copyColU32(key);
      if (!col) continue;
      const out = new Uint32Array(rows);
      out.set(col.subarray(0, kept));
      dst.setColU32(key, out);
    } else if (dtype === DType.I32) {
      const col = src.copyColI32(key);
      if (!col) continue;
      const out = new Int32Array(rows);
      out.set(col.subarray(0, kept));
      dst.setColI32(key, out);
    }
  }
}

/**
 * Snapshot committed scene → owned working Frame with dense atoms/bonds.
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

/** Copy `source` (cell, all atom columns, bonds) into an owned snapshot. */
function materializeWorkingFromSource(source: Frame): WorkingSnapshot {
  // Read the cell before taking Block borrows: the getter hands back an owned
  // copy, which is moved onto the working frame further down.
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
  const bondNumbers: number[] = [];
  if (bondBlock && bondBlock.nrows() > 0) {
    const iCol =
      bondBlock.viewColU32("atomi") ?? bondBlock.viewColU32("i") ?? null;
    const jCol =
      bondBlock.viewColU32("atomj") ?? bondBlock.viewColU32("j") ?? null;
    if (iCol && jCol) {
      const typeCol = bondBlock.dtype("bond_type")
        ? bondBlock.viewColU32("bond_type")
        : undefined;
      const numberCol = bondBlock.dtype("bond_number")
        ? bondBlock.viewColU32("bond_number")
        : undefined;
      for (let b = 0; b < bondBlock.nrows(); b++) {
        bonds.push([iCol[b], jCol[b]]);
        const t = typeCol?.[b] ?? BOND_TYPE_SINGLE;
        bondTypes.push(t);
        bondNumbers.push(numberCol?.[b] ?? t);
      }
    }
  }

  const frame = new Frame();
  const atomBlock = new Block();
  // Full column copy: charge / mol_id / res_seq / … must survive the round
  // trip, so the working frame — not just x/y/z — is the writeback template.
  cloneAtomColumns(atoms, atomBlock, n);
  atomBlock.setColF("x", x);
  atomBlock.setColF("y", y);
  atomBlock.setColF("z", z);
  atomBlock.setColStr("element", elements);
  frame.insertBlock("atoms", atomBlock);

  if (bonds.length > 0) {
    const bb = new Block();
    const atomi = new Uint32Array(bonds.length);
    const atomj = new Uint32Array(bonds.length);
    const types = new Uint32Array(bonds.length);
    const numbers = new Uint32Array(bonds.length);
    for (let b = 0; b < bonds.length; b++) {
      atomi[b] = bonds[b][0];
      atomj[b] = bonds[b][1];
      types[b] = bondTypes[b] ?? BOND_TYPE_SINGLE;
      numbers[b] = bondNumbers[b] ?? types[b];
    }
    setBondTopology(bb, atomi, atomj, types, numbers);
    frame.insertBlock("bonds", bb);
  }

  // Getter returned a copy; the setter moves that copy into the new frame.
  if (sourceBox) frame.box = sourceBox;

  const orders = bonds.map((_, i) =>
    displayBondOrder(
      bondTypes[i] ?? BOND_TYPE_SINGLE,
      bondNumbers[i] ?? bondTypes[i] ?? 1,
    ),
  );

  return { frame, cell, x, y, z, elements, bonds, orders };
}

function hasDrawModifiers(app: MolvisApp): boolean {
  return app.modifierPipeline
    .modifiers()
    .some((m) => m.enabled && m.capabilities.has(ModifierCapability.Draws));
}

function primaryDataSource(app: MolvisApp): DataSource | undefined {
  return headPrimary(app.modifierPipeline);
}

/**
 * Install / refresh DataSource so composition head sees `frame`, and ensure
 * Draw modifiers exist (auto-attach). Never commits the working tree — caller
 * must {@link MolvisApp.commitScene} first when dirty.
 *
 * `box` is the result frame's own cell, handed to the source so the
 * trajectory's per-frame slot matches the frame instead of being nulled.
 * A source that cannot take an edited HEAD throws from
 * {@link DataSource.replaceHeadFrame} — the optimize result never lands
 * half-published.
 */
function ensureDataSourceAndDraws(
  app: MolvisApp,
  frame: Frame,
  box?: Box,
): void {
  let ds = primaryDataSource(app);

  if (!ds) {
    ds = new MemoryDataSource(frame, {
      sourceType: "empty",
      filename: "Optimized",
    });
    app.modifierPipeline.addSource(ds);
    app.system.trajectory = ds.trajectory;
  } else {
    ds.replaceHeadFrame(frame, box);
    if (ds.trajectory === app.system.trajectory) {
      app.system.updateCurrentFrame(frame, box);
    } else {
      // One Frame, one owner: adopt the source's trajectory rather than
      // installing the same handle into a second one.
      app.system.trajectory = ds.trajectory;
    }
  }

  if (!hasDrawModifiers(app)) {
    applyAutoAttach(app.modifierPipeline, frame, undefined, ds);
  }
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
 * Build the frame to publish: the working snapshot's atom columns, with
 * coordinates / elements / bonds taken from the worker result and the source
 * cell re-attached as a fresh Box.
 *
 * The working frame is only read — the pre-optimize Frame the caller still
 * holds is never mutated.
 */
function buildResultFrame(
  working: WorkingSnapshot,
  result: OptimizeJobResult,
): Frame {
  const els = result.elements ?? [];
  if (els.length !== result.atomCount) {
    throw new Error(
      `Optimize result size mismatch: ${els.length} elements vs ${result.atomCount} atoms`,
    );
  }

  const outFrame = new Frame();
  const sourceAtoms = working.frame.getBlock("atoms");
  const atomBlock = new Block();
  if (sourceAtoms) {
    cloneAtomColumns(sourceAtoms, atomBlock, result.atomCount);
  }
  atomBlock.setColF("x", result.x);
  atomBlock.setColF("y", result.y);
  atomBlock.setColF("z", result.z);
  atomBlock.setColStr("element", els);
  outFrame.insertBlock("atoms", atomBlock);

  const bI = result.bondI;
  const bJ = result.bondJ;
  if (bI && bJ && bI.length > 0) {
    const bb = new Block();
    const types =
      result.bondType ??
      Uint32Array.from({ length: bI.length }, () => BOND_TYPE_SINGLE);
    setBondTopology(bb, bI, bJ, types, new Uint32Array(types));
    outFrame.insertBlock("bonds", bb);
  }

  // Fresh Box per attach — the setter moves what it is given.
  if (working.cell) outFrame.box = buildCellBox(working.cell);

  return outFrame;
}

/**
 * Relax the current **committed** scene geometry and publish the result.
 *
 * Heavy work (bond perception, typify, NeighborList, L-BFGS) runs in a
 * **Dedicated Worker** with its own molrs instance. The main thread snapshots
 * the structure, posts the job, forwards progress, and publishes the finished
 * geometry once — there is no mid-run canvas update.
 *
 * **Data kept across the round trip.** The snapshot copies *every* atom column
 * of the source frame (charge, `mol_id`, residue fields, …), not just
 * coordinates, and that copy is the template the published frame is cloned
 * from; the worker's coordinates / elements / bonds are written over it and the
 * source cell is re-attached as a fresh Box. The pre-optimize Frame is never
 * mutated, so a run that throws leaves the scene exactly as it was.
 *
 * **UI contract (main thread stays free to paint):**
 * - `options.onStatus` — every worker progress beat (prep + minimize lines + %)
 *   → page wires this to `status-message` / status bar
 * - `options.onProgress` — minimize step beats → panel progress bar
 * - After the job: rebuild Frame → {@link ensureDataSourceAndDraws} →
 *   `applyPipeline({ changeKind: "full" })` → 3D stage updates
 *
 * Cancelling via `options.shouldCancel` is not an abort: the last coordinates
 * the optimizer reached are still published, and the outcome reports
 * `cancelled: true`.
 *
 * @throws UnsavedSceneError when the scene has uncommitted canvas edits —
 *   commit first
 * @throws Error when `potential` and `optimizer` do not pair (see
 *   {@link resolveOptimizePair}); when the scene has no atoms or no x/y/z; when
 *   the system is too large for the chosen potential (size assessment blocks
 *   it, before and again after hydrogens are added); when the cell is
 *   **triclinic**, because the job payload carries edge lengths only and a
 *   tilted cell would be optimized — and written back — squared; when the
 *   worker or its job fails; and when the primary DataSource cannot take an
 *   edited HEAD (a file or socket source), which surfaces from
 *   {@link DataSource.replaceHeadFrame} instead of dropping the result
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

  // The working frame is the writeback template, so it lives until publish.
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
      // The job payload carries edge lengths only, and the writeback rebuilds
      // the cell from them — a tilted cell would silently ship (and come back)
      // squared. Refuse rather than optimize against the wrong periodicity.
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
      shouldCancel: options.shouldCancel,
    });

    status?.({
      phase: "finalize",
      message: result.cancelled
        ? "Applying last coordinates…"
        : "Updating view…",
    });
    await yieldForPaint();

    // Rebuild a main-thread Frame for pipeline / stage publish.
    const outFrame = buildResultFrame(working, result);

    // Stage (3D): DataSource + draws + full pipeline rebuild. The trajectory
    // slot gets its own Box copy so `currentBox` never falls back to nothing.
    ensureDataSourceAndDraws(app, outFrame, outFrame.box);
    await app.applyPipeline({ changeKind: "full" });
    await waitForNextEngineFrame(app);

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
  } finally {
    // One release point: the template is a true ephemeral, owned only here.
    safeFree(working.frame);
  }
}
