import { Block, Frame, Perceive } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
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
import {
  type GeometryOptimizeMethod,
  isWasmForceField,
  packCoords,
  runGeometryOptimize,
  runWasmGeometryOptimize,
  unpackCoords,
} from "./geometry_optimize";

export interface StructureOptimizeOptions {
  method?: GeometryOptimizeMethod;
  maxSteps?: number;
  forceTol?: number;
  /** Atom indices (dense frame indices) fixed during minimization. */
  fixedIndices?: readonly number[];
  /** Cap missing valence with explicit H before relaxing (default true). */
  addHydrogens?: boolean;
  /**
   * How often to push a position update through the pipeline. Defaults scale
   * with atom count so large systems stay responsive.
   */
  reportEvery?: number;
  shouldCancel?: () => boolean;
  onProgress?: (info: {
    step: number;
    maxSteps: number;
    energy: number;
    maxForce: number;
    converged: boolean;
  }) => void;
}

export interface StructureOptimizeOutcome {
  steps: number;
  energy: number;
  maxForce: number;
  converged: boolean;
  cancelled: boolean;
  atomCount: number;
  fixedCount: number;
  hydrogensAdded: number;
  method: GeometryOptimizeMethod;
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
  const bondBlock = source.getBlock("bonds");
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

  const box = source.box;
  if (box) frame.box = box;

  const orders = bonds.map((_, i) =>
    displayBondOrder(
      bondTypes[i] ?? BOND_TYPE_SINGLE,
      bondNumbers[i] ?? bondTypes[i] ?? 1,
    ),
  );

  return { frame, x, y, z, elements, bonds, orders };
}

function writeCoords(
  frame: Frame,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
): void {
  const atoms = frame.getBlock("atoms");
  if (!atoms) throw new Error("Working frame lost atoms block");
  atoms.setColF("x", x);
  atoms.setColF("y", y);
  atoms.setColF("z", z);
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
export async function runStructureOptimize(
  app: MolvisApp,
  options: StructureOptimizeOptions = {},
): Promise<StructureOptimizeOutcome> {
  if (app.world.sceneIndex.hasUnsavedChanges) {
    throw new UnsavedSceneError();
  }

  const method = options.method ?? "uff";
  const maxSteps = options.maxSteps ?? 200;
  const forceTol = options.forceTol ?? 0.05;
  const fixedIndices = options.fixedIndices ?? [];
  const wantHydrogens = options.addHydrogens !== false;

  let working = snapshotWorkingFrame(app);
  let hydrogensAdded = 0;

  if (wantHydrogens) {
    // molrs chemical perception: Perceive.findHydrogens (not a free function).
    const before = working.elements.length;
    let capped: Frame;
    try {
      capped = new Perceive().findHydrogens(working.frame);
    } catch (err) {
      working.frame.free();
      throw err instanceof Error ? err : new Error(String(err));
    }
    const after = capped.getBlock("atoms")?.nrows() ?? 0;
    hydrogensAdded = Math.max(0, after - before);
    if (hydrogensAdded > 0) {
      working.frame.free();
      working = materializeWorkingFromSource(capped);
      capped.free();
    } else {
      capped.free();
    }
  }

  const { frame, x, y, z, elements, bonds, orders } = working;
  writeCoords(frame, x, y, z);
  const n = elements.length;
  const reportEvery =
    options.reportEvery ??
    (isWasmForceField(method)
      ? n > 400
        ? 8
        : n > 120
          ? 4
          : 2
      : n > 400
        ? 4
        : n > 120
          ? 2
          : 1);

  ensureDataSourceAndDraws(app, frame);
  // Full rebuild so GPU frameOffset matches committed topology (and H-cap).
  await app.applyPipeline({ changeKind: "full" });
  await waitForNextEngineFrame(app);

  try {
    const onStep = async (step: {
      step: number;
      coords: Float64Array;
      energy: number;
      maxForce: number;
      converged: boolean;
    }) => {
      unpackCoords(step.coords, x, y, z);
      await publishPositionFrame(app, frame, x, y, z);
      options.onProgress?.({
        step: step.step,
        maxSteps,
        energy: step.energy,
        maxForce: step.maxForce,
        converged: step.converged,
      });
    };

    const outcome = isWasmForceField(method)
      ? await runWasmGeometryOptimize(
          {
            frame,
            method,
            maxSteps,
            forceTol,
            fixed: fixedIndices,
            reportEvery,
            shouldCancel: options.shouldCancel,
          },
          onStep,
        )
      : await runGeometryOptimize(
          {
            coords: packCoords(x, y, z),
            elements,
            bonds,
            orders,
            fixed: fixedIndices,
            method,
            maxSteps,
            forceTol,
            reportEvery,
            shouldCancel: options.shouldCancel,
          },
          onStep,
        );

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
      method,
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
      frame.free();
    }
    throw err;
  }
}
