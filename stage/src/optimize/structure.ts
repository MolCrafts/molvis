/**
 * Structure optimize — app orchestration.
 *
 * Snapshot committed scene → optional bonds/H → {@link runLbfgsOptimize}
 * / {@link runDampedOptimize} → pipeline publish. Pure methods live in
 * {@link ./relax}.
 */
import { Block, Frame, Perceive } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import { ComputeBondsModifier } from "../modifiers/ComputeBondsModifier";
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
import { safeFree } from "../utils/yield_ui";
import {
  assessOptimizeSize,
  defaultOptimizeReportEvery,
  isMolrsPotential,
  type OptimizerKind,
  type OptimizeStatusCallback,
  type PotentialKind,
  packCoords,
  resolveOptimizePair,
  runDampedOptimize,
  runLbfgsOptimize,
  unpackCoords,
  yieldToUi,
} from "./relax";

/** App-level options: {@link PotentialKind} × {@link OptimizerKind}. */
export interface OptimizeOptions {
  /** Energy model (UFF / MMFF / soft). */
  potential?: PotentialKind;
  /** Optimizer; defaults from potential (`lbfgs` for FF, `damped` for soft). */
  optimizer?: OptimizerKind;
  maxSteps?: number;
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
   * How often to push a position update through the pipeline. Defaults scale
   * with atom count so large systems stay responsive.
   */
  reportEvery?: number;
  /**
   * When false, skip mid-run canvas position publishes (status still updates).
   * Defaults: off for large systems so 20k-atom previews do not freeze the tab.
   */
  livePreview?: boolean;
  shouldCancel?: () => boolean;
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

export interface OptimizeOutcome {
  steps: number;
  energy: number;
  maxForce: number;
  converged: boolean;
  cancelled: boolean;
  atomCount: number;
  fixedCount: number;
  hydrogensAdded: number;
  potential: PotentialKind;
  optimizer: OptimizerKind;
}

/** Thrown when the working tree is dirty — UI must ask the user to commit. */
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
 * Snapshot committed scene → owned working Frame with dense atoms/bonds.
 * Prefers system.frame (DataSource HEAD). Caller must have committed when dirty.
 */
function snapshotWorkingFrame(app: MolvisApp): {
  frame: Frame;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  elements: string[];
  bonds: Array<[number, number]>;
  orders: number[];
} {
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

function materializeWorkingFromSource(source: Frame): {
  frame: Frame;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  elements: string[];
  bonds: Array<[number, number]>;
  orders: number[];
} {
  const atoms = source.getBlock("atoms");
  const bondBlock = source.getBlock("bonds");
  try {
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

    // JS-owned copies are complete — release Block borrows before box / free.
    safeFree(atoms);
    safeFree(bondBlock);

    const frame = new Frame();
    const atomBlock = new Block();
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

    // Getter returns a copy; setter moves that copy into the new frame.
    const box = source.box;
    if (box) frame.box = box;

    const orders = bonds.map((_, i) =>
      displayBondOrder(
        bondTypes[i] ?? BOND_TYPE_SINGLE,
        bondNumbers[i] ?? bondTypes[i] ?? 1,
      ),
    );

    return { frame, x, y, z, elements, bonds, orders };
  } finally {
    safeFree(atoms);
    safeFree(bondBlock);
  }
}

function writeCoords(
  frame: Frame,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
): void {
  const atoms = frame.getBlock("atoms");
  try {
    if (!atoms) throw new Error("Working frame lost atoms block");
    atoms.setColF("x", x);
    atoms.setColF("y", y);
    atoms.setColF("z", z);
  } finally {
    safeFree(atoms);
  }
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
 */
function ensureDataSourceAndDraws(app: MolvisApp, frame: Frame): void {
  let ds = primaryDataSource(app);

  if (!ds) {
    ds = new MemoryDataSource(frame, {
      sourceType: "empty",
      filename: "Optimized",
    });
    app.modifierPipeline.addSource(ds);
    app.system.trajectory = ds.trajectory;
  } else {
    app.system.updateCurrentFrame(frame);
    if (ds.trajectory !== app.system.trajectory) {
      if (ds.kind === "memory" && ds.frameCount === 1) {
        ds.trajectory.replaceFrame(0, frame);
      }
    }
  }

  if (!hasDrawModifiers(app)) {
    applyAutoAttach(app.modifierPipeline, frame, undefined, ds);
  }
}

/**
 * Publish coords: write columns → DS trajectory slot → position pipeline path
 * → one Babylon frame. Does not bypass DataSource.
 */
async function publishPositionFrame(
  app: MolvisApp,
  frame: Frame,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
): Promise<void> {
  writeCoords(frame, x, y, z);
  app.system.updateCurrentFrame(frame);
  const ds = primaryDataSource(app);
  if (ds && ds.trajectory !== app.system.trajectory) {
    if (ds.kind === "memory" && ds.frameCount === 1) {
      ds.trajectory.replaceFrame(0, frame);
    }
  }
  await app.applyPipeline({ changeKind: "position" });
  await waitForNextEngineFrame(app);
}

/**
 * Relax the current **committed** scene geometry with live updates.
 *
 * Refuses to run when the working tree is dirty — the page must ask the user
 * to {@link MolvisApp.commitScene} first (never silent commit).
 *
 * Ingress: DataSource → `applyPipeline({ changeKind: "position" | "full" })`.
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
  // Default off: H-cap on large systems can 3–4× N past interactive limits.
  const wantHydrogens = options.addHydrogens === true;
  const wantEnsureBonds =
    options.ensureBonds !== false && isMolrsPotential(potential);
  const status = options.onStatus;

  status?.({
    phase: "snapshot",
    message: "Sinking scene → molrs Frame…",
    progress: 1,
  });
  await yieldToUi();

  let working = snapshotWorkingFrame(app);
  let hydrogensAdded = 0;

  // Size gate from estimated peak memory vs this device + WASM L-BFGS atom cap.
  {
    const risk = assessOptimizeSize(working.elements.length, potential, {
      bondCount: working.bonds.length,
    });
    if (risk.level === "hard_block" || risk.level === "soft_block") {
      safeFree(working.frame);
      throw new Error(risk.message);
    }
  }

  // Force fields need topology. CIF/mmCIF often has zero bonds — perceive.
  // ComputeBonds.perceive moves atom storage into the returned frame; always
  // re-materialize from that result when perception runs.
  if (wantEnsureBonds && working.bonds.length === 0) {
    status?.({
      phase: "prepare",
      message: "No bonds on frame — perceiving connectivity…",
      progress: 2,
    });
    await yieldToUi();
    let perceived: Frame | null = null;
    try {
      perceived = ComputeBondsModifier.perceiveForForceField(working.frame);
      const nBonds = perceived.getBlock("bonds")?.nrows() ?? 0;
      safeFree(working.frame);
      working = materializeWorkingFromSource(perceived);
      status?.({
        phase: "prepare",
        message:
          nBonds === 0
            ? "No bonds found — force field will run nonbonded-only…"
            : `Perceived ${nBonds.toLocaleString()} bonds for force field…`,
        progress: 2,
      });
    } catch (err) {
      // Soft-fail: keep original working frame if perception never ran.
      status?.({
        phase: "prepare",
        message: `Bond perception failed (${err instanceof Error ? err.message : String(err)}); continuing without bonds…`,
        progress: 2,
      });
    } finally {
      if (perceived) safeFree(perceived);
    }
    await yieldToUi();
  }

  if (wantHydrogens) {
    status?.({
      phase: "hydrogens",
      message: "Adding hydrogens (Perceive)…",
      progress: 3,
    });
    await yieldToUi();
    // molrs chemical perception: Perceive.findHydrogens (not a free function).
    const before = working.elements.length;
    const perceive = new Perceive();
    let capped: Frame;
    try {
      capped = perceive.findHydrogens(working.frame);
    } catch (err) {
      safeFree(working.frame);
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      safeFree(perceive);
    }
    let after = 0;
    {
      const ab = capped.getBlock("atoms");
      try {
        after = ab?.nrows() ?? 0;
      } finally {
        safeFree(ab);
      }
    }
    hydrogensAdded = Math.max(0, after - before);
    if (hydrogensAdded > 0) {
      safeFree(working.frame);
      try {
        working = materializeWorkingFromSource(capped);
      } finally {
        safeFree(capped);
      }
      await yieldToUi();
      // Re-check after H inflation (proteins often 3–4×; can exceed WASM L-BFGS cap).
      const risk = assessOptimizeSize(working.elements.length, potential, {
        bondCount: working.bonds.length,
      });
      if (risk.level === "hard_block" || risk.level === "soft_block") {
        safeFree(working.frame);
        throw new Error(
          hydrogensAdded > 0
            ? `${risk.message} (+${hydrogensAdded} H added — try turning off Add hydrogens.)`
            : risk.message,
        );
      }
    } else {
      safeFree(capped);
    }
  }

  const { frame, x, y, z, elements, bonds, orders } = working;
  writeCoords(frame, x, y, z);
  const n = elements.length;
  const reportEvery =
    options.reportEvery ?? defaultOptimizeReportEvery(n, potential);
  // Live canvas preview is expensive; default off once N is mid-size so the
  // main thread is free for L-BFGS chunks + status paints.
  const livePreview =
    options.livePreview ?? (isMolrsPotential(potential) ? n <= 800 : n <= 400);
  // Publish positions less often than L-BFGS chunk reports on mid-size systems.
  const previewEvery = livePreview
    ? n > 1_200
      ? Math.max(reportEvery * 2, 16)
      : reportEvery
    : Number.POSITIVE_INFINITY;

  status?.({
    phase: "pipeline",
    message: "Preparing draw pipeline…",
    progress: 6,
  });
  await yieldToUi();
  ensureDataSourceAndDraws(app, frame);
  // Full rebuild so GPU frameOffset matches committed topology (and H-cap).
  await app.applyPipeline({ changeKind: "full" });
  await waitForNextEngineFrame(app);

  try {
    let lastPreviewStep = 0;
    const onStep = async (step: {
      step: number;
      coords: Float64Array;
      energy: number;
      maxForce: number;
      converged: boolean;
    }) => {
      unpackCoords(step.coords, x, y, z);
      const shouldPreview =
        step.converged ||
        step.step - lastPreviewStep >= previewEvery ||
        step.step === maxSteps;
      if (shouldPreview && Number.isFinite(previewEvery)) {
        lastPreviewStep = step.step;
        await publishPositionFrame(app, frame, x, y, z);
      } else {
        writeCoords(frame, x, y, z);
        await yieldToUi();
      }
      options.onProgress?.({
        step: step.step,
        maxSteps,
        energy: step.energy,
        maxForce: step.maxForce,
        converged: step.converged,
      });
    };

    const outcome = isMolrsPotential(potential)
      ? await runLbfgsOptimize(
          {
            frame,
            potential,
            maxSteps,
            forceTol,
            fixed: fixedIndices,
            reportEvery,
            shouldCancel: options.shouldCancel,
            onStatus: status,
          },
          onStep,
        )
      : await runDampedOptimize(
          {
            coords: packCoords(x, y, z),
            elements,
            bonds,
            orders,
            fixed: fixedIndices,
            potential: "soft",
            maxSteps,
            forceTol,
            reportEvery,
            shouldCancel: options.shouldCancel,
            onStatus: status,
          },
          onStep,
        );

    status?.({
      phase: "finalize",
      message: outcome.cancelled
        ? "Cancelling — applying last coordinates…"
        : "Finalizing structure…",
      progress: 99,
    });
    await yieldToUi();

    unpackCoords(outcome.coords, x, y, z);
    writeCoords(frame, x, y, z);
    app.system.updateCurrentFrame(frame);
    const ds = primaryDataSource(app);
    if (ds && ds.trajectory !== app.system.trajectory) {
      if (ds.kind === "memory" && ds.frameCount === 1) {
        ds.trajectory.replaceFrame(0, frame);
      }
    }
    await app.applyPipeline({ changeKind: "full" });
    await waitForNextEngineFrame(app);

    return {
      steps: outcome.steps,
      energy: outcome.energy,
      maxForce: outcome.maxForce,
      converged: outcome.converged,
      cancelled: outcome.cancelled,
      atomCount: n,
      fixedCount: fixedIndices.length,
      hydrogensAdded,
      potential,
      optimizer,
    };
  } catch (err) {
    const stillReferenced = app.modifierPipeline
      .sources()
      .some(
        (m) =>
          m.trajectory === app.system.trajectory ||
          (m.kind === "memory" && m.peekFrame === frame),
      );
    if (!stillReferenced) {
      safeFree(frame);
    }
    throw err;
  }
}
