import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import {
  WorkloadHost,
  type WorkloadRequest,
  type WorkloadResponse,
} from "@molcrafts/molvis-core/workload";
import { afterEach, describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import type {
  ComputeJob,
  ComputeProgress,
  ComputeResult,
} from "../../src/compute/protocol";
import { setComputeRuntimeForTests } from "../../src/compute/runtime";
import type { OptimizeJobResult } from "../../src/optimize/protocol";
import { runOptimize } from "../../src/optimize/structure";
import {
  FileDataSource,
  MemoryDataSource,
} from "../../src/pipeline/data_source";
import { BaseModifier, ModifierCapability } from "../../src/pipeline/modifier";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { System } from "../../src/system";
import { Trajectory } from "../../src/system/trajectory";

// ---------------------------------------------------------------------------
// Scripted compute worker (in-process): the optimize job comes back as a
// hard-coded "slightly moved" echo, so this file only exercises structure.ts —
// no real DedicatedWorker, no worker-side molrs.
// ---------------------------------------------------------------------------

/** Input geometry (Å). Water-like, three atoms, two bonds. */
const IN_X = [1.0, 1.96, 0.76] as const;
const IN_Y = [0.5, 0.5, 1.43] as const;
const IN_Z = [0.5, 0.5, 0.5] as const;
const IN_CHARGE = [-0.8, 0.4, 0.4] as const;
const IN_MOL_ID = [7, 7, 7] as const;
const ELEMENTS = ["O", "H", "H"] as const;

/** Hard-coded "optimized" coordinates the fake worker echoes back. */
const OUT_X = [1.02, 1.94, 0.78] as const;
const OUT_Y = [0.52, 0.5, 1.41] as const;
const OUT_Z = [0.5, 0.5, 0.52] as const;

/** Orthorhombic cell: three different edges, non-zero origin. */
const BOX_LENGTHS = [8, 5, 6] as const;
const BOX_ORIGIN = [1.5, -2.25, 0.75] as const;

class ScriptedComputeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;

  postMessage(data: WorkloadRequest<ComputeJob>, _transfer?: unknown): void {
    if (data.type !== "run") return;
    const { id } = data;
    queueMicrotask(() => {
      const result: OptimizeJobResult = {
        x: Float64Array.from(OUT_X),
        y: Float64Array.from(OUT_Y),
        z: Float64Array.from(OUT_Z),
        elements: [...ELEMENTS],
        bondI: Uint32Array.from([0, 0]),
        bondJ: Uint32Array.from([1, 2]),
        steps: 3,
        energy: -4.25,
        maxForce: 0.01,
        converged: true,
        cancelled: false,
        atomCount: 3,
        hydrogensAdded: 0,
        potential: "uff",
        optimizer: "lbfgs",
      };
      this.emit({
        type: "done",
        id,
        result: { kind: "optimize", result } satisfies ComputeResult,
      });
    });
  }

  terminate(): void {
    /* nothing to tear down */
  }

  signalReady(): void {
    queueMicrotask(() => {
      this.emit({ type: "ready" });
    });
  }

  private emit(msg: WorkloadResponse): void {
    const ev = { data: msg } as MessageEvent;
    this.onmessage?.(ev);
  }
}

/** Install a real WorkloadHost driven by the scripted fake worker. */
function installComputeHost(): void {
  const fake = new ScriptedComputeWorker();
  setComputeRuntimeForTests(
    new WorkloadHost<ComputeJob, ComputeResult, ComputeProgress>({
      name: "test-compute",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Stub app seam
// ---------------------------------------------------------------------------

/** Draw-capable no-op so runOptimize skips registry auto-attach. */
class StubDrawModifier extends BaseModifier {
  constructor() {
    super(
      "stub-draw",
      "Stub Draw",
      new Set<ModifierCapability>([ModifierCapability.Draws]),
    );
  }

  apply(input: Frame): Frame {
    return input;
  }
}

/**
 * The slice of MolvisApp runOptimize touches: a clean scene index, the real
 * System / ModifierPipeline, a no-op pipeline publish, and an engine frame
 * that completes immediately.
 */
function makeStubApp(system: System, pipeline: ModifierPipeline): MolvisApp {
  return {
    world: {
      sceneIndex: { hasUnsavedChanges: false },
      scene: {
        onAfterRenderObservable: {
          addOnce: (cb: () => void) => {
            cb();
          },
        },
      },
    },
    system,
    modifierPipeline: pipeline,
    applyPipeline: async () => {
      /* publish is out of scope here — assertions read the DataSource head */
    },
    // Only the members runOptimize touches are stubbed; the cast is the seam.
  } as unknown as MolvisApp;
}

/** Water-like frame with extra canonical atom columns and an optional cell. */
function makeInputFrame(box?: Box): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", Float64Array.from(IN_X));
  atoms.setColF("y", Float64Array.from(IN_Y));
  atoms.setColF("z", Float64Array.from(IN_Z));
  atoms.setColStr("element", [...ELEMENTS]);
  atoms.setColF("charge", Float64Array.from(IN_CHARGE));
  atoms.setColU32("mol_id", Uint32Array.from(IN_MOL_ID));
  frame.insertBlock("atoms", atoms);

  const bonds = new Block();
  bonds.setColU32("atomi", Uint32Array.from([0, 0]));
  bonds.setColU32("atomj", Uint32Array.from([1, 2]));
  bonds.setColU32("bond_type", Uint32Array.from([1, 1]));
  frame.insertBlock("bonds", bonds);

  if (box) frame.box = box;
  return frame;
}

function orthoCell(): Box {
  return Box.ortho(
    Float64Array.from(BOX_LENGTHS),
    Float64Array.from(BOX_ORIGIN),
    true,
    true,
    true,
  );
}

/** Triclinic cell (LAMMPS-style xy tilt) as a row-major h matrix. */
function triclinicCell(): Box {
  // a = (8,0,0), b = (2.5,5,0), c = (0,0,6) — xy tilt 2.5 Å.
  const h = Float64Array.from([8, 2.5, 0, 0, 5, 0, 0, 0, 6]);
  return new Box(h, Float64Array.from(BOX_ORIGIN), true, true, true);
}

/** Primary memory source whose trajectory IS the system trajectory. */
function installMemoryPrimary(
  system: System,
  pipeline: ModifierPipeline,
  frame: Frame,
): MemoryDataSource {
  const ds = new MemoryDataSource(frame, {
    sourceType: "file",
    filename: "input.xyz",
  });
  pipeline.addSource(ds);
  pipeline.addModifier(new StubDrawModifier());
  system.trajectory = ds.trajectory;
  return ds;
}

function headAtoms(frame: Frame): Block {
  const atoms = frame.getBlock("atoms");
  if (!atoms) throw new Error("head frame lost its atoms block");
  return atoms;
}

describe("runOptimize (structure writeback)", () => {
  afterEach(() => {
    setComputeRuntimeForTests(null);
  });

  it("keeps the simulation cell on the published head frame", async () => {
    installComputeHost();
    const system = new System();
    const pipeline = new ModifierPipeline();
    const ds = installMemoryPrimary(
      system,
      pipeline,
      makeInputFrame(orthoCell()),
    );
    const app = makeStubApp(system, pipeline);

    await runOptimize(app, { potential: "uff" });

    const head = ds.getFrame(0);
    const box = head.box;
    expect(box).toBeTruthy();
    if (!box) return;
    const lengthsArr = box.lengths();
    const originArr = box.origin();
    const lengths = lengthsArr.toCopy();
    const origin = originArr.toCopy();
    lengthsArr.free();
    originArr.free();
    // Position tolerance (Å): exact round-trip of the input cell.
    expect(lengths[0]).toBeCloseTo(BOX_LENGTHS[0], 12);
    expect(lengths[1]).toBeCloseTo(BOX_LENGTHS[1], 12);
    expect(lengths[2]).toBeCloseTo(BOX_LENGTHS[2], 12);
    expect(origin[0]).toBeCloseTo(BOX_ORIGIN[0], 12);
    expect(origin[1]).toBeCloseTo(BOX_ORIGIN[1], 12);
    expect(origin[2]).toBeCloseTo(BOX_ORIGIN[2], 12);
  }, 30_000);

  it("keeps non-coordinate atom columns on the published head frame", async () => {
    installComputeHost();
    const system = new System();
    const pipeline = new ModifierPipeline();
    const ds = installMemoryPrimary(
      system,
      pipeline,
      makeInputFrame(orthoCell()),
    );
    const app = makeStubApp(system, pipeline);

    await runOptimize(app, { potential: "uff" });

    const atoms = headAtoms(ds.getFrame(0));
    expect(atoms.nrows()).toBe(3);
    expect(atoms.dtype("charge")).toBeDefined();
    expect(atoms.dtype("mol_id")).toBeDefined();
    const charge = atoms.copyColF("charge");
    const molId = atoms.copyColU32("mol_id");
    const x = atoms.copyColF("x");
    for (let i = 0; i < 3; i++) {
      expect(charge[i]).toBeCloseTo(IN_CHARGE[i], 10);
      expect(molId[i]).toBe(IN_MOL_ID[i]);
      // Coordinates are the optimized ones, not the input ones.
      expect(x[i]).toBeCloseTo(OUT_X[i], 12);
    }
  }, 30_000);

  it("leaves the pre-optimize frame untouched", async () => {
    installComputeHost();
    const system = new System();
    const pipeline = new ModifierPipeline();
    const input = makeInputFrame(orthoCell());
    installMemoryPrimary(system, pipeline, input);
    const app = makeStubApp(system, pipeline);

    await runOptimize(app, { potential: "uff" });

    const x = headAtoms(input).copyColF("x");
    for (let i = 0; i < 3; i++) {
      expect(x[i]).toBeCloseTo(IN_X[i], 12);
    }
  }, 30_000);

  it("refuses to publish into a diverged non-memory primary source", async () => {
    installComputeHost();
    const system = new System();
    const pipeline = new ModifierPipeline();
    // Primary is a file source over its own trajectory; the system points at
    // a different one — the optimized frame has nowhere to land.
    const fileSide = new Trajectory([makeInputFrame(orthoCell())]);
    const ds = new FileDataSource(fileSide, {
      sourceType: "file",
      filename: "input.xyz",
    });
    pipeline.addSource(ds);
    pipeline.addModifier(new StubDrawModifier());
    system.trajectory = new Trajectory([makeInputFrame(orthoCell())]);
    expect(ds.trajectory).not.toBe(system.trajectory);
    const app = makeStubApp(system, pipeline);

    await expect(runOptimize(app, { potential: "uff" })).rejects.toThrow();
  }, 30_000);

  it("refuses a triclinic cell instead of shipping a silently squared one", async () => {
    // The job payload carries edge lengths only (no tilts), so a tilted cell
    // cannot cross the wire — it must be a hard error, never a wrong cell.
    installComputeHost();
    const system = new System();
    const pipeline = new ModifierPipeline();
    installMemoryPrimary(system, pipeline, makeInputFrame(triclinicCell()));
    const app = makeStubApp(system, pipeline);

    await expect(runOptimize(app, { potential: "uff" })).rejects.toThrow();
  }, 30_000);
});
