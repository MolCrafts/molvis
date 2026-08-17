import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { afterEach, describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import type { ComputeResult } from "../../src/compute/protocol";
import { setComputeRuntimeForTests } from "../../src/compute/runtime";
import type { AtomMeta, BondMeta } from "../../src/entity_source";
import { EventEmitter, type MolvisEventMap } from "../../src/events";
import type {
  OptimizeJobPayload,
  OptimizeJobResult,
} from "../../src/optimize/protocol";
import { runOptimize, UnsavedSceneError } from "../../src/optimize/structure";
import {
  FileDataSource,
  MemoryDataSource,
} from "../../src/pipeline/data_source";
import { BaseModifier, ModifierCapability } from "../../src/pipeline/modifier";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { System } from "../../src/system";
import { Trajectory } from "../../src/system/trajectory";
import { installScriptedComputeHost } from "../workload_test_helpers";

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

/**
 * The persistent status line a staged result leaves behind (spec
 * optimize-staging-03-command). Byte-for-byte: em dash, not a hyphen.
 */
const STAGED_HINT = "Optimized — Ctrl+S to save";

/** Position tolerance (Å): exact round trip of plain numbers. */
const POSITION_DIGITS = 12;

/**
 * Install a real WorkloadHost driven by the scripted fake worker.
 *
 * @returns The optimize payloads the host posted, in order. The fake worker
 * hands the script the very object `runOptimizeOnWorker` posted (the transfer
 * list is inert in-process), so a payload is inspectable exactly as the real
 * worker would receive it.
 */
function installComputeHost(
  overrides: Partial<OptimizeJobResult> = {},
): OptimizeJobPayload[] {
  const posted: OptimizeJobPayload[] = [];
  installScriptedComputeHost(({ id, job, emit }) => {
    if (job.kind === "optimize") posted.push(job.payload);
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
      ...overrides,
    };
    emit({
      type: "done",
      id,
      result: { kind: "optimize", result } satisfies ComputeResult,
    });
  });
  return posted;
}

// ---------------------------------------------------------------------------
// Stub app seam
//
// The optimize result no longer rewrites HEAD: it is staged as one undoable
// command that writes through the edit pool (spec
// optimize-staging-03-command). The stub therefore carries the canvas-side
// collaborators — scene index, artist, highlighter, command manager, events —
// as structural fakes. They are faithful where it matters: `updateAtom` merges
// meta immutably and marks the scene unsaved, exactly like `SceneIndex`.
//
// The command's own contract (capture timing, undo, redo, the non-call list)
// is pinned in tests/commands/optimize_result.test.ts; this file only pins what
// runOptimize does with it.
// ---------------------------------------------------------------------------

interface BufferDesc {
  data: Float32Array;
  stride: number;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface AxisOut {
  set(x: number, y: number, z: number): unknown;
}

const ATOM_MESH_ID = 11;
const STUB_CAPACITY = 8;

/** Frame-segment impostor rows: ids 0..2 map to rows 0..2 (identity). */
class StubAtomImpostorState {
  readonly mesh = { uniqueId: ATOM_MESH_ID };
  readonly buffers = new Map<string, BufferDesc>([
    ["matrix", { data: new Float32Array(STUB_CAPACITY * 16), stride: 16 }],
    ["instanceData", { data: new Float32Array(STUB_CAPACITY * 4), stride: 4 }],
  ]);
  /** Forbidden call: wipes the edit pool and resets frameOffset. */
  setFrameDataCalls = 0;

  constructor(private readonly frameOffset: number) {}

  renderIndicesForLogicalId(id: number): number[] {
    return id < this.frameOffset ? [id] : [];
  }

  markDirty(..._names: string[]): void {}

  setFrameData(): void {
    this.setFrameDataCalls += 1;
  }
}

class StubAtomSource {
  readonly edits = new Map<number, AtomMeta>();

  constructor(private readonly frameMetas: readonly AtomMeta[]) {}

  getMeta(id: number): AtomMeta | null {
    return this.edits.get(id) ?? this.frameMetas[id] ?? null;
  }

  setEdit(id: number, meta: AtomMeta): void {
    this.edits.set(id, meta);
  }

  removeEdit(id: number): void {
    this.edits.delete(id);
  }

  getMaxId(): number {
    let max = this.frameMetas.length - 1;
    for (const id of this.edits.keys()) max = Math.max(max, id);
    return max;
  }
}

class StubBondSource {
  readonly edits = new Map<number, BondMeta>();

  getMeta(id: number): BondMeta | null {
    return this.edits.get(id) ?? null;
  }

  setEdit(id: number, meta: BondMeta): void {
    this.edits.set(id, meta);
  }

  removeEdit(id: number): void {
    this.edits.delete(id);
  }

  getMaxId(): number {
    let max = -1;
    for (const id of this.edits.keys()) max = Math.max(max, id);
    return max;
  }
}

class StubTopology {
  private readonly edges = new Map<number, [number, number]>();
  private readonly adjacency = new Map<number, number[]>();

  addAtom(_atomId: number): void {}

  removeAtom(_atomId: number): void {}

  addBond(bondId: number, atom1: number, atom2: number): void {
    this.edges.set(bondId, [atom1, atom2]);
    for (const atom of [atom1, atom2]) {
      const bonds = this.adjacency.get(atom);
      if (bonds) bonds.push(bondId);
      else this.adjacency.set(atom, [bondId]);
    }
  }

  removeBond(bondId: number): void {
    this.edges.delete(bondId);
  }

  incident(atomId: number): number[] {
    return this.adjacency.get(atomId) ?? [];
  }

  endpoints(bondId: number): [number, number] | undefined {
    return this.edges.get(bondId);
  }

  getBondsForAtom(atomId: number): number[] {
    return this.incident(atomId);
  }
}

/** Committed canvas: the same three atoms and two bonds as the input frame. */
class StubSceneIndex {
  readonly meshRegistry: {
    getAtomState: () => StubAtomImpostorState;
    getBondState: () => null;
  };
  readonly metaRegistry: { atoms: StubAtomSource; bonds: StubBondSource };
  readonly topology = new StubTopology();
  readonly atomState = new StubAtomImpostorState(ELEMENTS.length);
  /**
   * Position writes that reached the edit pool. `updateAtom` is
   * `EditPoolPositions.writeAtom`'s only outbound door, so this list counts
   * exactly the writeAtom calls that landed.
   */
  readonly updateAtomCalls: Array<{ atomId: number; position?: Vec3Like }> = [];
  registerAtomFrameCalls = 0;
  promoteFrameToEditPoolCalls = 0;
  private unsaved = false;

  constructor() {
    this.metaRegistry = {
      atoms: new StubAtomSource(
        ELEMENTS.map((element, i) => ({
          type: "atom",
          atomId: i,
          element,
          position: { x: IN_X[i], y: IN_Y[i], z: IN_Z[i] },
        })),
      ),
      bonds: new StubBondSource(),
    };
    this.meshRegistry = {
      getAtomState: () => this.atomState,
      // Bond rebuilds are ring 01's contract, pinned in
      // tests/edit_pool_positions.test.ts — out of scope for this file.
      getBondState: () => null,
    };
    this.topology.addBond(0, 0, 1);
    this.topology.addBond(1, 0, 2);
  }

  get hasUnsavedChanges(): boolean {
    return this.unsaved;
  }

  markAllUnsaved(): void {
    this.unsaved = true;
  }

  markAllSaved(): void {
    this.unsaved = false;
  }

  getNextAtomId(): number {
    return this.metaRegistry.atoms.getMaxId() + 1;
  }

  getNextBondId(): number {
    return this.metaRegistry.bonds.getMaxId() + 1;
  }

  createAtom(meta: Omit<AtomMeta, "type">): void {
    this.metaRegistry.atoms.setEdit(meta.atomId, { type: "atom", ...meta });
    this.markAllUnsaved();
  }

  createBond(meta: Omit<BondMeta, "type">): void {
    this.metaRegistry.bonds.setEdit(meta.bondId, { type: "bond", ...meta });
    this.topology.addBond(meta.bondId, meta.atomId1, meta.atomId2);
    this.markAllUnsaved();
  }

  unregisterEditAtom(_meshId: number, atomId: number): void {
    this.metaRegistry.atoms.removeEdit(atomId);
    this.markAllUnsaved();
  }

  unregisterEditBond(_meshId: number, bondId: number): void {
    this.metaRegistry.bonds.removeEdit(bondId);
    this.topology.removeBond(bondId);
    this.markAllUnsaved();
  }

  updateAtom(
    _meshId: number,
    atomId: number,
    meta: Partial<Omit<AtomMeta, "type">>,
    _bufferUpdates?: Map<string, Float32Array>,
  ): void {
    this.updateAtomCalls.push({ atomId, position: meta.position });
    const existing = this.metaRegistry.atoms.getMeta(atomId);
    if (existing) {
      this.metaRegistry.atoms.setEdit(atomId, { ...existing, ...meta });
    }
    this.markAllUnsaved();
  }

  updateBond(
    _meshId: number,
    bondId: number,
    meta: Partial<Omit<BondMeta, "type">>,
    _bufferUpdates?: Map<string, Float32Array>,
  ): void {
    const existing = this.metaRegistry.bonds.getMeta(bondId);
    if (existing) {
      this.metaRegistry.bonds.setEdit(bondId, { ...existing, ...meta });
    }
    this.markAllUnsaved();
  }

  bondPlaneAxis(
    _atomId1: number,
    _position1: Vec3Like,
    _atomId2: number,
    _position2: Vec3Like,
    _direction: Vec3Like,
    out: AxisOut,
  ): void {
    out.set(0, 0, 1);
  }

  registerAtomFrame(): void {
    this.registerAtomFrameCalls += 1;
  }

  promoteFrameToEditPool(): void {
    this.promoteFrameToEditPoolCalls += 1;
  }
}

class StubArtist {
  paintCalls = 0;

  constructor(private readonly scene: StubSceneIndex) {}

  async drawAtom(
    position: Vec3Like,
    options: { element: string; atomId?: number },
  ): Promise<{ atomId: number; meshId: number }> {
    const atomId = options.atomId ?? this.scene.getNextAtomId();
    this.scene.createAtom({
      atomId,
      element: options.element,
      position: { x: position.x, y: position.y, z: position.z },
    });
    return { atomId, meshId: ATOM_MESH_ID };
  }

  async drawBond(
    start: Vec3Like,
    end: Vec3Like,
    options: {
      bondId?: number;
      atomId1?: number;
      atomId2?: number;
      bondType?: number;
      bondNumber?: number;
    } = {},
  ): Promise<{ bondId: number; meshId: number }> {
    const bondId = options.bondId ?? this.scene.getNextBondId();
    this.scene.createBond({
      bondId,
      atomId1: options.atomId1 ?? -1,
      atomId2: options.atomId2 ?? -1,
      bondType: options.bondType ?? 1,
      bondNumber: options.bondNumber ?? 1,
      start: { x: start.x, y: start.y, z: start.z },
      end: { x: end.x, y: end.y, z: end.z },
    });
    return { bondId, meshId: 22 };
  }

  deleteAtom(meshId: number, atomId: number): void {
    this.scene.unregisterEditAtom(meshId, atomId);
  }

  deleteBond(meshId: number, bondId: number): void {
    this.scene.unregisterEditBond(meshId, bondId);
  }

  applySceneIndexToMeshes(): void {
    this.paintCalls += 1;
  }
}

class StubHighlighter {
  calls = 0;

  invalidateAndRebuild(): void {
    this.calls += 1;
  }
}

/** Records what runOptimize handed the history, and runs it. */
class StubCommandManager {
  readonly executed: Array<{ undo?: unknown }> = [];

  async execute<T>(command: {
    do(): T | Promise<T>;
    undo?: unknown;
  }): Promise<T> {
    this.executed.push(command);
    return command.do();
  }
}

class StubStyleManager {
  getAtomStyle(_element: string): { radius: number; color: string } {
    return { radius: 0.3, color: "#ffffff" };
  }

  getBondStyle(_sticks: number): { radius: number } {
    return { radius: 0.15 };
  }
}

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
 * The slice of MolvisApp runOptimize touches, plus the probes the assertions
 * read: emitted info lines, executed commands, pipeline publishes.
 */
class StubAppKit {
  readonly events = new EventEmitter<MolvisEventMap>();
  readonly infoTexts: string[] = [];
  readonly sceneIndex = new StubSceneIndex();
  readonly artist: StubArtist;
  readonly highlighter = new StubHighlighter();
  readonly commandManager = new StubCommandManager();
  readonly styleManager = new StubStyleManager();
  /** Forbidden on the staged path: recomputes the frame from its sources. */
  applyPipelineCalls = 0;
  readonly app: MolvisApp;

  constructor(system: System, pipeline: ModifierPipeline) {
    this.artist = new StubArtist(this.sceneIndex);
    this.events.on("info-text-change", (text) => {
      this.infoTexts.push(text);
    });
    this.app = {
      world: {
        sceneIndex: this.sceneIndex,
        highlighter: this.highlighter,
      },
      artist: this.artist,
      styleManager: this.styleManager,
      commandManager: this.commandManager,
      events: this.events,
      system,
      modifierPipeline: pipeline,
      applyPipeline: async () => {
        this.applyPipelineCalls += 1;
      },
      // Only the members runOptimize touches are stubbed; the cast is the seam.
    } as unknown as MolvisApp;
  }

  /** Staged position of a canvas atom (Å). */
  position(atomId: number): Vec3Like {
    const meta = this.sceneIndex.metaRegistry.atoms.getMeta(atomId);
    if (!meta) throw new Error(`atom ${atomId} has no meta`);
    return meta.position;
  }
}

/**
 * Water-like frame with extra canonical atom columns and an optional cell.
 *
 * `bondTypes` is the molrs `bond_type` column of the two bonds; the default is
 * two single bonds. Pass a non-single entry to prove the order survives the
 * trip to the worker.
 */
function makeInputFrame(
  box?: Box,
  bondTypes: readonly [number, number] = [1, 1],
): Frame {
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
  bonds.setColU32("bond_type", Uint32Array.from(bondTypes));
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

/** Memory-source scene, ready to optimize. */
function makeScene(
  box?: Box,
  bondTypes?: readonly [number, number],
): {
  kit: StubAppKit;
  ds: MemoryDataSource;
} {
  const system = new System();
  const pipeline = new ModifierPipeline();
  const ds = installMemoryPrimary(
    system,
    pipeline,
    makeInputFrame(box, bondTypes),
  );
  return { kit: new StubAppKit(system, pipeline), ds };
}

describe("runOptimize", () => {
  afterEach(() => {
    setComputeRuntimeForTests(null);
  });

  describe("job payload", () => {
    it("carries the source bond orders to the worker", async () => {
      // Regression: `workingToJob` used to omit `bondType` entirely, so the
      // worker's job runner fell back to BOND_TYPE_SINGLE and relaxed every
      // double / triple / aromatic bond with single-bond force-field
      // parameters — a wrong geometry, silently.
      //
      // The pair below is a topology fixture, not chemistry: one single plus
      // one non-single bond is the smallest input that tells "carried" apart
      // from "defaulted to single".
      const jobs = installComputeHost();
      const { kit } = makeScene(orthoCell(), [1, 2]);

      await runOptimize(kit.app, { potential: "uff" });

      expect(jobs.length).toBe(1);
      const payload = jobs[0];
      expect(payload.bondType).toBeInstanceOf(Uint32Array);
      expect(Array.from(payload.bondType ?? [])).toEqual([1, 2]);
      // Parallel arrays: an order only means something next to its own bond.
      expect(Array.from(payload.bondI)).toEqual([0, 0]);
      expect(Array.from(payload.bondJ)).toEqual([1, 2]);
    }, 30_000);
  });

  describe("staging the result", () => {
    it("writes the optimized coordinates into the edit pool and dirties the scene", async () => {
      // ac-007: the run ends with an uncommitted canvas edit, not a published
      // frame. The optimized coordinates are the ones now on screen.
      installComputeHost();
      const { kit } = makeScene(orthoCell());

      await runOptimize(kit.app, { potential: "uff" });

      expect(kit.sceneIndex.hasUnsavedChanges).toBe(true);
      expect(kit.sceneIndex.updateAtomCalls.length).toBe(3);
      for (let id = 0; id < 3; id++) {
        const p = kit.position(id);
        expect(p.x).toBeCloseTo(OUT_X[id], POSITION_DIGITS);
        expect(p.y).toBeCloseTo(OUT_Y[id], POSITION_DIGITS);
        expect(p.z).toBeCloseTo(OUT_Z[id], POSITION_DIGITS);
      }
    }, 30_000);

    it("never rebuilds the scene to show the result", async () => {
      // ac-004 at the caller: staging is a buffer patch. applyPipeline would
      // recompute the frame from its sources and discard the staged edit.
      installComputeHost();
      const { kit } = makeScene(orthoCell());

      await runOptimize(kit.app, { potential: "uff" });

      expect(kit.applyPipelineCalls).toBe(0);
      expect(kit.sceneIndex.registerAtomFrameCalls).toBe(0);
      expect(kit.sceneIndex.promoteFrameToEditPoolCalls).toBe(0);
      expect(kit.sceneIndex.atomState.setFrameDataCalls).toBe(0);
    }, 30_000);

    it("emits the persistent save hint as an info line", async () => {
      // ac-007: a persistent `info-text-change` line (manipulate.emitStatus's
      // shape) so VSCode / Python hosts see it too, not only the page.
      installComputeHost();
      const { kit } = makeScene(orthoCell());

      await runOptimize(kit.app, { potential: "uff" });

      expect(kit.infoTexts).toContain(STAGED_HINT);
    }, 30_000);

    it("hands the result to the history as one undoable command", async () => {
      // The single ingress: app.commandManager.execute(...). Anything else and
      // the result never enters the undo stack (base.ts:42-50).
      installComputeHost();
      const { kit } = makeScene(orthoCell());

      await runOptimize(kit.app, { potential: "uff" });

      expect(kit.commandManager.executed.length).toBe(1);
      expect(typeof kit.commandManager.executed[0].undo).toBe("function");
    }, 30_000);

    it("stages a cancelled result the same way — cancel is stop, not undo", async () => {
      installComputeHost({ cancelled: true, converged: false, steps: 1 });
      const { kit } = makeScene(orthoCell());

      const outcome = await runOptimize(kit.app, { potential: "uff" });

      expect(outcome.cancelled).toBe(true);
      expect(kit.sceneIndex.hasUnsavedChanges).toBe(true);
      expect(kit.infoTexts).toContain(STAGED_HINT);
      for (let id = 0; id < 3; id++) {
        expect(kit.position(id).x).toBeCloseTo(OUT_X[id], POSITION_DIGITS);
      }
    }, 30_000);
  });

  describe("source data", () => {
    // MIGRATION (spec optimize-staging-03-command): the two cases that pinned
    // the published HEAD frame ("keeps the simulation cell…", "keeps
    // non-coordinate atom columns…") are replaced by their staged inverse —
    // HEAD is not written at all. Column and cell survival now happens at
    // commit time via materializeFrameFromScene(sourceFrame), pinned in
    // tests/build_frame_from_scene.test.ts ("keeps source atom columns on
    // commit", "preserves the simulation box from the source frame").
    it("leaves the DataSource HEAD untouched — coordinates, columns and cell", async () => {
      installComputeHost();
      const { kit, ds } = makeScene(orthoCell());

      await runOptimize(kit.app, { potential: "uff" });

      const head = ds.getFrame(0);
      const atoms = headAtoms(head);
      expect(atoms.nrows()).toBe(3);
      const x = atoms.copyColF("x");
      const charge = atoms.copyColF("charge");
      const molId = atoms.copyColU32("mol_id");
      for (let i = 0; i < 3; i++) {
        // Still the pre-optimize geometry: the result lives in the edit pool
        // until the user saves.
        expect(x[i]).toBeCloseTo(IN_X[i], POSITION_DIGITS);
        expect(charge[i]).toBeCloseTo(IN_CHARGE[i], 10);
        expect(molId[i]).toBe(IN_MOL_ID[i]);
      }

      const box = head.box;
      expect(box).toBeTruthy();
      if (!box) return;
      const lengthsArr = box.lengths();
      const originArr = box.origin();
      const lengths = lengthsArr.toCopy();
      const origin = originArr.toCopy();
      lengthsArr.free();
      originArr.free();
      for (let i = 0; i < 3; i++) {
        expect(lengths[i]).toBeCloseTo(BOX_LENGTHS[i], POSITION_DIGITS);
        expect(origin[i]).toBeCloseTo(BOX_ORIGIN[i], POSITION_DIGITS);
      }
    }, 30_000);

    it("leaves the pre-optimize frame untouched", async () => {
      installComputeHost();
      const system = new System();
      const pipeline = new ModifierPipeline();
      const input = makeInputFrame(orthoCell());
      installMemoryPrimary(system, pipeline, input);
      const kit = new StubAppKit(system, pipeline);

      await runOptimize(kit.app, { potential: "uff" });

      const x = headAtoms(input).copyColF("x");
      for (let i = 0; i < 3; i++) {
        expect(x[i]).toBeCloseTo(IN_X[i], POSITION_DIGITS);
      }
    }, 30_000);

    // MIGRATION (spec optimize-staging-03-command): was "refuses to publish
    // into a diverged non-memory primary source". Staging never calls
    // replaceHeadFrame, so a file-backed source no longer blocks the run —
    // that is the point: file-loaded structures become optimizable, and
    // landing the result stays commitScene's gate.
    it("stages into a file-backed primary source instead of refusing", async () => {
      installComputeHost();
      const system = new System();
      const pipeline = new ModifierPipeline();
      const fileSide = new Trajectory([makeInputFrame(orthoCell())]);
      const ds = new FileDataSource(fileSide, {
        sourceType: "file",
        filename: "input.xyz",
      });
      pipeline.addSource(ds);
      pipeline.addModifier(new StubDrawModifier());
      system.trajectory = new Trajectory([makeInputFrame(orthoCell())]);
      expect(ds.trajectory).not.toBe(system.trajectory);
      const kit = new StubAppKit(system, pipeline);

      await runOptimize(kit.app, { potential: "uff" });

      expect(kit.sceneIndex.hasUnsavedChanges).toBe(true);
      // FileDataSource reads lazily — its HEAD is a promise, unlike a memory
      // source's.
      const x = headAtoms(await ds.getFrame(0)).copyColF("x");
      for (let i = 0; i < 3; i++) {
        expect(x[i]).toBeCloseTo(IN_X[i], POSITION_DIGITS);
      }
    }, 30_000);
  });

  describe("gates", () => {
    it("refuses a dirty scene and leaves the edit pool untouched", async () => {
      // ac-008: optimize starts from a clean HEAD. Recovery (commit / discard)
      // is a product decision, never a silent overwrite.
      installComputeHost();
      const { kit } = makeScene(orthoCell());
      kit.sceneIndex.markAllUnsaved();

      const error = await runOptimize(kit.app, { potential: "uff" }).then(
        () => null,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(UnsavedSceneError);
      expect(error instanceof UnsavedSceneError ? error.code : "").toBe(
        "UNSAVED_SCENE",
      );
      expect(kit.sceneIndex.updateAtomCalls).toEqual([]);
      expect(kit.commandManager.executed).toEqual([]);
      expect(kit.infoTexts).toEqual([]);
    }, 30_000);

    it("refuses a triclinic cell instead of shipping a silently squared one", async () => {
      // The job payload carries edge lengths only (no tilts), so a tilted cell
      // cannot cross the wire — it must be a hard error, never a wrong cell.
      installComputeHost();
      const { kit } = makeScene(triclinicCell());

      await expect(
        runOptimize(kit.app, { potential: "uff" }),
      ).rejects.toThrow();
    }, 30_000);
  });
});
