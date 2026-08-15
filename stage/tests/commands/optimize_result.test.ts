import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../../src/app";
import {
  type OptimizeStagePlan,
  StageOptimizeResultCommand,
} from "../../src/commands/optimize_result";
import type { AtomMeta, BondMeta } from "../../src/entity_source";

// Unit under test: stage/src/commands/optimize_result.ts (spec
// optimize-staging-03-command). The optimize result is a *staged* edit: one
// undoable command that writes coordinates through the edit pool, adds the
// worker's hydrogens/bonds, and never rebuilds the scene.
//
// Every collaborator is a STRUCTURAL fake — no Babylon mesh, no molrs handle,
// no MolvisApp. The fakes are faithful where faithfulness is load-bearing:
//
//   * `FakeSceneIndex.updateAtom` merges meta immutably and marks the scene
//     unsaved, exactly like `SceneIndex.updateAtom`, so a position written
//     through `EditPoolPositions.writeAtom` (ring 01's only write door) is
//     observable as `metaRegistry.atoms.getMeta(id).position`.
//   * `FakeAtomSource` models the frame segment + edit overlay split of the
//     real `AtomSource` (`getAllIds` semantics), so "edit-pool atom count"
//     means the same thing here as on a live scene.
//   * `FakeArtist.drawAtom` / `drawBond` route into `createAtom` / `createBond`
//     and `deleteAtom` / `deleteBond` into `unregisterEdit*`, the same one-way
//     street the real Artist walks. Undo therefore really removes.
//
// Deliberately NOT faked into existence: `applyPipeline`, `registerAtomFrame`,
// `ImpostorState.setFrameData`, `promoteFrameToEditPool`. They exist here only
// as call counters — the command must never touch them (they reset
// `frameOffset` / wipe the edit pool / recompute the frame).

/** Plain vector shape; the production path may hand us a Babylon Vector3. */
interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The write end of the offset-axis out-parameter used by `bondPlaneAxis`. */
interface AxisOut {
  set(x: number, y: number, z: number): unknown;
}

interface BufferDesc {
  data: Float32Array;
  stride: number;
}

interface BufferDef {
  name: string;
  stride: number;
}

/** Subset of ATOM_IMPOSTOR_SPEC.bufferDefs a position write touches. */
const ATOM_BUFFER_DEFS: readonly BufferDef[] = [
  { name: "matrix", stride: 16 },
  { name: "instanceData", stride: 4 },
];

/** Subset of BOND_IMPOSTOR_SPEC.bufferDefs; a bond rebuild needs the mesh id. */
const BOND_BUFFER_DEFS: readonly BufferDef[] = [
  { name: "matrix", stride: 16 },
  { name: "instanceData0", stride: 4 },
  { name: "instanceData1", stride: 4 },
];

const CAPACITY = 32;
const ATOM_MESH_ID = 11;
const BOND_MESH_ID = 22;

/**
 * Frame segment + edit pool rows, with the real `ImpostorState` resolution
 * order (id < frameOffset ⇒ identity row; otherwise idToIndex + frameOffset).
 */
class FakeImpostorState {
  readonly mesh: { uniqueId: number };
  readonly buffers = new Map<string, BufferDesc>();
  readonly idToIndex = new Map<number, number>();
  readonly markDirtyCalls: string[][] = [];
  /** Forbidden call: wipes the edit pool and resets frameOffset. */
  setFrameDataCalls = 0;
  private nextEditIndex = 0;
  private readonly freeIndices: number[] = [];

  constructor(
    uniqueId: number,
    defs: readonly BufferDef[],
    readonly frameOffset: number,
  ) {
    this.mesh = { uniqueId };
    for (const def of defs) {
      this.buffers.set(def.name, {
        data: new Float32Array(CAPACITY * def.stride),
        stride: def.stride,
      });
    }
  }

  allocate(id: number): void {
    const reused = this.freeIndices.pop();
    this.idToIndex.set(id, reused ?? this.nextEditIndex++);
  }

  free(id: number): void {
    const index = this.idToIndex.get(id);
    if (index === undefined) return;
    this.idToIndex.delete(id);
    this.freeIndices.push(index);
  }

  renderIndicesForLogicalId(id: number): number[] {
    if (id < this.frameOffset) return [id];
    const editIndex = this.idToIndex.get(id);
    return editIndex === undefined ? [] : [editIndex + this.frameOffset];
  }

  markDirty(...names: string[]): void {
    this.markDirtyCalls.push(names);
  }

  setFrameData(): void {
    this.setFrameDataCalls += 1;
  }

  desc(name: string): BufferDesc {
    const desc = this.buffers.get(name);
    if (!desc) throw new Error(`fake buffer ${name} missing`);
    return desc;
  }
}

class FakeMeshRegistry {
  constructor(
    private readonly atoms: FakeImpostorState,
    private readonly bonds: FakeImpostorState,
  ) {}

  getAtomState(): FakeImpostorState {
    return this.atoms;
  }

  getBondState(): FakeImpostorState {
    return this.bonds;
  }
}

/** Frame-segment metas plus the edit overlay, like the real `AtomSource`. */
class FakeAtomSource {
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

  /** Mirrors `AtomSource.getAllIds`: frame rows, then edit-only ids. */
  allIds(): number[] {
    const ids = this.frameMetas.map((_, i) => i);
    for (const id of this.edits.keys()) {
      if (id >= this.frameMetas.length) ids.push(id);
    }
    return ids;
  }

  /** Ids that exist only because something created them (added hydrogens). */
  editOnlyIds(): number[] {
    return [...this.edits.keys()].filter((id) => id >= this.frameMetas.length);
  }
}

class FakeBondSource {
  readonly edits = new Map<number, BondMeta>();

  constructor(private readonly frameMetas: readonly BondMeta[]) {}

  getMeta(id: number): BondMeta | null {
    return this.edits.get(id) ?? this.frameMetas[id] ?? null;
  }

  setEdit(id: number, meta: BondMeta): void {
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

  allIds(): number[] {
    const ids = this.frameMetas.map((_, i) => i);
    for (const id of this.edits.keys()) {
      if (id >= this.frameMetas.length) ids.push(id);
    }
    return ids;
  }

  editOnlyIds(): number[] {
    return [...this.edits.keys()].filter((id) => id >= this.frameMetas.length);
  }
}

class FakeMetaRegistry {
  readonly atoms: FakeAtomSource;
  readonly bonds: FakeBondSource;

  constructor(atoms: readonly AtomMeta[], bonds: readonly BondMeta[]) {
    this.atoms = new FakeAtomSource(atoms);
    this.bonds = new FakeBondSource(bonds);
  }
}

class FakeTopology {
  private readonly edges = new Map<number, [number, number]>();
  private readonly adjacency = new Map<number, number[]>();
  private readonly atomIds = new Set<number>();

  addAtom(atomId: number): void {
    this.atomIds.add(atomId);
  }

  removeAtom(atomId: number): void {
    this.atomIds.delete(atomId);
  }

  addBond(bondId: number, atom1: number, atom2: number): void {
    this.edges.set(bondId, [atom1, atom2]);
    for (const atom of [atom1, atom2]) {
      const bonds = this.adjacency.get(atom);
      if (bonds) bonds.push(bondId);
      else this.adjacency.set(atom, [bondId]);
    }
  }

  removeBond(bondId: number): void {
    const ends = this.edges.get(bondId);
    this.edges.delete(bondId);
    if (!ends) return;
    for (const atom of ends) {
      const bonds = this.adjacency.get(atom);
      if (!bonds) continue;
      this.adjacency.set(
        atom,
        bonds.filter((id) => id !== bondId),
      );
    }
  }

  incident(atomId: number): number[] {
    return this.adjacency.get(atomId) ?? [];
  }

  endpoints(bondId: number): [number, number] | undefined {
    return this.edges.get(bondId);
  }

  /** Name the real `TopologyIndex` uses; DeleteAtomCommand-family callers. */
  getBondsForAtom(atomId: number): number[] {
    return this.incident(atomId);
  }
}

type UpdateAtomArgs = [
  meshId: number,
  atomId: number,
  meta: Partial<Omit<AtomMeta, "type">>,
  bufferUpdates?: Map<string, Float32Array>,
];

/**
 * The `SceneIndex` surface a staged optimize result may touch. Every mutation
 * is faithful to the real class; the four forbidden entry points are counters.
 */
class FakeSceneIndex {
  readonly meshRegistry: FakeMeshRegistry;
  readonly topology = new FakeTopology();
  readonly updateAtomCalls: UpdateAtomArgs[] = [];
  readonly updateBondCalls: number[] = [];
  /** Forbidden: would clear the edit pool. */
  registerAtomFrameCalls = 0;
  /** Forbidden: double promotion of the frame segment. */
  promoteFrameToEditPoolCalls = 0;
  private unsaved = false;

  constructor(
    readonly metaRegistry: FakeMetaRegistry,
    private readonly atomState: FakeImpostorState,
    bondState: FakeImpostorState,
    private readonly order: string[],
  ) {
    this.meshRegistry = new FakeMeshRegistry(atomState, bondState);
  }

  get hasUnsavedChanges(): boolean {
    return this.unsaved;
  }

  markAllUnsaved(): void {
    this.unsaved = true;
    this.order.push("markAllUnsaved");
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
    this.atomState.allocate(meta.atomId);
    this.metaRegistry.atoms.setEdit(meta.atomId, { type: "atom", ...meta });
    this.topology.addAtom(meta.atomId);
    this.markAllUnsaved();
  }

  createBond(meta: Omit<BondMeta, "type">): void {
    this.metaRegistry.bonds.setEdit(meta.bondId, { type: "bond", ...meta });
    this.topology.addBond(meta.bondId, meta.atomId1, meta.atomId2);
    this.markAllUnsaved();
  }

  unregisterEditAtom(_meshId: number, atomId: number): void {
    this.metaRegistry.atoms.removeEdit(atomId);
    this.topology.removeAtom(atomId);
    this.atomState.free(atomId);
    this.markAllUnsaved();
  }

  unregisterEditBond(_meshId: number, bondId: number): void {
    this.metaRegistry.bonds.removeEdit(bondId);
    this.topology.removeBond(bondId);
    this.markAllUnsaved();
  }

  updateAtom(
    meshId: number,
    atomId: number,
    meta: Partial<Omit<AtomMeta, "type">>,
    bufferUpdates?: Map<string, Float32Array>,
  ): void {
    this.updateAtomCalls.push([meshId, atomId, meta, bufferUpdates]);
    const existing = this.metaRegistry.atoms.getMeta(atomId);
    // New object per write — never mutate the meta already handed out.
    if (existing)
      this.metaRegistry.atoms.setEdit(atomId, { ...existing, ...meta });
    this.markAllUnsaved();
  }

  updateBond(
    _meshId: number,
    bondId: number,
    meta: Partial<Omit<BondMeta, "type">>,
    _bufferUpdates?: Map<string, Float32Array>,
  ): void {
    this.updateBondCalls.push(bondId);
    const existing = this.metaRegistry.bonds.getMeta(bondId);
    if (existing)
      this.metaRegistry.bonds.setEdit(bondId, { ...existing, ...meta });
    this.markAllUnsaved();
  }

  /** Geometry kernel stub — the offset math is ring 01's, not this command's. */
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

/** Artist stand-in: style → buffers → createAtom, without Babylon. */
class FakeArtist {
  readonly drawnAtoms: Array<{ atomId: number; element: string } & Vec3Like> =
    [];
  readonly drawnBonds: Array<{
    bondId: number;
    atomId1: number;
    atomId2: number;
  }> = [];
  readonly deletedAtomIds: number[] = [];
  readonly deletedBondIds: number[] = [];
  paintCalls = 0;

  constructor(
    private readonly scene: FakeSceneIndex,
    private readonly order: string[],
  ) {}

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
    this.drawnAtoms.push({
      atomId,
      element: options.element,
      x: position.x,
      y: position.y,
      z: position.z,
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
    const atomId1 = options.atomId1 ?? -1;
    const atomId2 = options.atomId2 ?? -1;
    this.scene.createBond({
      bondId,
      atomId1,
      atomId2,
      bondType: options.bondType ?? 1,
      bondNumber: options.bondNumber ?? 1,
      start: { x: start.x, y: start.y, z: start.z },
      end: { x: end.x, y: end.y, z: end.z },
    });
    this.drawnBonds.push({ bondId, atomId1, atomId2 });
    return { bondId, meshId: BOND_MESH_ID };
  }

  deleteAtom(meshId: number, atomId: number): void {
    this.deletedAtomIds.push(atomId);
    this.scene.unregisterEditAtom(meshId, atomId);
  }

  deleteBond(meshId: number, bondId: number): void {
    this.deletedBondIds.push(bondId);
    this.scene.unregisterEditBond(meshId, bondId);
  }

  applySceneIndexToMeshes(): void {
    this.paintCalls += 1;
    this.order.push("applySceneIndexToMeshes");
  }
}

class FakeHighlighter {
  /**
   * The unambiguous {@link ScenePaintTick.flush} marker: nothing else in the
   * staged path rebuilds the highlight, so this count IS the flush count.
   */
  calls = 0;

  constructor(private readonly order: string[]) {}

  invalidateAndRebuild(): void {
    this.calls += 1;
    this.order.push("invalidateAndRebuild");
  }
}

/**
 * The command is handed to `commandManager.execute(...)` by its caller
 * (`runOptimize`). It must never re-enter the manager itself — that would
 * stack the same action twice.
 */
class FakeCommandManager {
  readonly executed: unknown[] = [];

  async execute(command: unknown): Promise<unknown> {
    this.executed.push(command);
    return undefined;
  }
}

class FakeStyleManager {
  getAtomStyle(_element: string): { radius: number; color: string } {
    return { radius: 0.3, color: "#ffffff" };
  }

  getBondStyle(_sticks: number): { radius: number } {
    return { radius: 0.15 };
  }
}

/** Base scene (Å): three atoms, two bonds — the pre-optimize canvas. */
const BASE_ELEMENTS = ["C", "C", "O"] as const;
const BEFORE_X = [0, 1, 0] as const;
const BEFORE_Y = [0, 0, 0] as const;
const BEFORE_Z = [0, 0, 0] as const;
const BASE_ATOM_COUNT = 3;

/** Optimized coordinates (Å) the plan carries — hard-coded goldens. */
const PLAN_X = [0.1, 0.9, 0] as const;
const PLAN_Y = [0, 0, 0.05] as const;
const PLAN_Z = [0, 0, 0] as const;

/** Positions (Å) of the two hydrogens the worker capped valences with. */
const ADDED_X = [1.6, -0.5] as const;
const ADDED_Y = [0.3, 0.2] as const;
const ADDED_Z = [0, 0] as const;

/** Position tolerance: exact round trip, no float32 detour (1e-12 Å). */
const POSITION_DIGITS = 12;

function baseAtomMetas(): AtomMeta[] {
  return BASE_ELEMENTS.map((element, i) => ({
    type: "atom",
    atomId: i,
    element,
    position: { x: BEFORE_X[i], y: BEFORE_Y[i], z: BEFORE_Z[i] },
  }));
}

function baseBondMetas(): BondMeta[] {
  // Bond 0: atoms 0–1. Bond 1: atoms 1–2.
  return [
    [0, 1],
    [1, 2],
  ].map(([atomId1, atomId2], bondId) => ({
    type: "bond",
    bondId,
    atomId1,
    atomId2,
    bondType: 1,
    bondNumber: 1,
    start: {
      x: BEFORE_X[atomId1],
      y: BEFORE_Y[atomId1],
      z: BEFORE_Z[atomId1],
    },
    end: { x: BEFORE_X[atomId2], y: BEFORE_Y[atomId2], z: BEFORE_Z[atomId2] },
  }));
}

/** Fake app surface + the handles the assertions read. */
class Kit {
  readonly order: string[] = [];
  readonly atomState = new FakeImpostorState(
    ATOM_MESH_ID,
    ATOM_BUFFER_DEFS,
    BASE_ATOM_COUNT,
  );
  readonly bondState = new FakeImpostorState(BOND_MESH_ID, BOND_BUFFER_DEFS, 2);
  readonly metaRegistry = new FakeMetaRegistry(
    baseAtomMetas(),
    baseBondMetas(),
  );
  readonly sceneIndex: FakeSceneIndex;
  readonly artist: FakeArtist;
  readonly highlighter = new FakeHighlighter(this.order);
  readonly commandManager = new FakeCommandManager();
  readonly styleManager = new FakeStyleManager();
  /** Forbidden: recomputes the frame from its sources, discarding the edit. */
  applyPipelineCalls = 0;
  readonly app: MolvisApp;

  constructor() {
    this.sceneIndex = new FakeSceneIndex(
      this.metaRegistry,
      this.atomState,
      this.bondState,
      this.order,
    );
    this.artist = new FakeArtist(this.sceneIndex, this.order);
    for (let i = 0; i < BASE_ATOM_COUNT; i++)
      this.sceneIndex.topology.addAtom(i);
    this.sceneIndex.topology.addBond(0, 0, 1);
    this.sceneIndex.topology.addBond(1, 1, 2);
    this.app = {
      world: {
        sceneIndex: this.sceneIndex,
        highlighter: this.highlighter,
      },
      artist: this.artist,
      styleManager: this.styleManager,
      commandManager: this.commandManager,
      applyPipeline: async () => {
        this.applyPipelineCalls += 1;
      },
      // Only the members a staged optimize result may touch; the cast is the
      // seam, exactly as in tests/commands/place_molecule.test.ts.
    } as unknown as MolvisApp;
  }

  position(atomId: number): { x: number; y: number; z: number } {
    const meta = this.metaRegistry.atoms.getMeta(atomId);
    if (!meta) throw new Error(`atom ${atomId} has no meta`);
    return meta.position;
  }
}

/** Plan with no growth: three optimized positions, topology unchanged. */
function samePlan(): OptimizeStagePlan {
  return {
    x: Float64Array.from(PLAN_X),
    y: Float64Array.from(PLAN_Y),
    z: Float64Array.from(PLAN_Z),
    elements: [...BASE_ELEMENTS],
    bondI: Uint32Array.from([0, 1]),
    bondJ: Uint32Array.from([1, 2]),
    bondType: Uint32Array.from([1, 1]),
    baseAtomCount: BASE_ATOM_COUNT,
  };
}

/**
 * Plan with two capped hydrogens: rows 3 and 4 are new atoms, and the last two
 * bonds (0–3, 0–4) are the only new ones. The first two bonds repeat topology
 * the scene already has — a staging pass that re-creates them would double the
 * molecule's bonds.
 */
function growthPlan(): OptimizeStagePlan {
  return {
    x: Float64Array.from([...PLAN_X, ...ADDED_X]),
    y: Float64Array.from([...PLAN_Y, ...ADDED_Y]),
    z: Float64Array.from([...PLAN_Z, ...ADDED_Z]),
    elements: [...BASE_ELEMENTS, "H", "H"],
    bondI: Uint32Array.from([0, 1, 0, 0]),
    bondJ: Uint32Array.from([1, 2, 3, 4]),
    bondType: Uint32Array.from([1, 1, 1, 1]),
    baseAtomCount: BASE_ATOM_COUNT,
  };
}

describe("TestStageOptimizeResultCommand", () => {
  describe("do", () => {
    it("writes the planned coordinates onto the base atoms", async () => {
      // ac-001: the staged geometry IS the plan, in angstrom, id i ← row i.
      const kit = new Kit();
      const command = new StageOptimizeResultCommand(kit.app, samePlan());

      await command.do();

      for (let id = 0; id < BASE_ATOM_COUNT; id++) {
        const p = kit.position(id);
        expect(p.x).toBeCloseTo(PLAN_X[id], POSITION_DIGITS);
        expect(p.y).toBeCloseTo(PLAN_Y[id], POSITION_DIGITS);
        expect(p.z).toBeCloseTo(PLAN_Z[id], POSITION_DIGITS);
      }
    });

    it("creates exactly the planned new atoms and their new bonds", async () => {
      // ac-003 (forward half): two hydrogens, two bonds — the two bonds the
      // scene already carries must NOT be re-created.
      const kit = new Kit();
      const command = new StageOptimizeResultCommand(kit.app, growthPlan());

      await command.do();

      expect(kit.metaRegistry.atoms.editOnlyIds()).toEqual([3, 4]);
      expect(kit.metaRegistry.atoms.allIds()).toEqual([0, 1, 2, 3, 4]);
      expect(kit.artist.drawnAtoms.map((a) => a.element)).toEqual(["H", "H"]);
      const added = kit.position(3);
      expect(added.x).toBeCloseTo(ADDED_X[0], POSITION_DIGITS);
      expect(added.y).toBeCloseTo(ADDED_Y[0], POSITION_DIGITS);
      expect(added.z).toBeCloseTo(ADDED_Z[0], POSITION_DIGITS);

      expect(kit.artist.drawnBonds.length).toBe(2);
      const pairs = kit.artist.drawnBonds
        .map((b) => `${b.atomId1}-${b.atomId2}`)
        .sort();
      expect(pairs).toEqual(["0-3", "0-4"]);
    });

    it("never rebuilds the scene, and paints exactly once", async () => {
      // ac-004: a staged result is a buffer patch, not a scene rebuild — and
      // one upload per action, not one per atom.
      const kit = new Kit();
      const command = new StageOptimizeResultCommand(kit.app, growthPlan());

      await command.do();

      expect(kit.applyPipelineCalls).toBe(0);
      expect(kit.sceneIndex.registerAtomFrameCalls).toBe(0);
      expect(kit.sceneIndex.promoteFrameToEditPoolCalls).toBe(0);
      expect(kit.atomState.setFrameDataCalls).toBe(0);
      expect(kit.bondState.setFrameDataCalls).toBe(0);
      // 3 written + 2 created atoms, still one flush.
      expect(kit.highlighter.calls).toBe(1);
    });

    it("does not re-enter the command manager", async () => {
      // The command carries no @command decorator and is executed by its
      // caller; self-executing would stack the same action twice.
      const kit = new Kit();
      const command = new StageOptimizeResultCommand(kit.app, samePlan());

      await command.do();

      expect(kit.commandManager.executed).toEqual([]);
    });
  });

  describe("undo", () => {
    it("restores the positions captured inside do(), not at construction", async () => {
      // ac-002: the snapshot is taken in do() (DeleteAtomCommand's shape), so
      // a scene that moved between construction and execution still undoes to
      // what was on screen when the command ran.
      const kit = new Kit();
      // Construction-time decoys: nothing here may end up restored.
      for (let id = 0; id < BASE_ATOM_COUNT; id++) {
        kit.metaRegistry.atoms.setEdit(id, {
          type: "atom",
          atomId: id,
          element: BASE_ELEMENTS[id],
          position: { x: -5, y: -5, z: -5 },
        });
      }
      const command = new StageOptimizeResultCommand(kit.app, samePlan());
      // …then the scene settles on the real pre-optimize geometry.
      for (let id = 0; id < BASE_ATOM_COUNT; id++) {
        kit.metaRegistry.atoms.setEdit(id, {
          type: "atom",
          atomId: id,
          element: BASE_ELEMENTS[id],
          position: { x: BEFORE_X[id], y: BEFORE_Y[id], z: BEFORE_Z[id] },
        });
      }

      await command.do();
      await command.undo();

      for (let id = 0; id < BASE_ATOM_COUNT; id++) {
        const p = kit.position(id);
        expect(p.x).toBeCloseTo(BEFORE_X[id], POSITION_DIGITS);
        expect(p.y).toBeCloseTo(BEFORE_Y[id], POSITION_DIGITS);
        expect(p.z).toBeCloseTo(BEFORE_Z[id], POSITION_DIGITS);
      }
    });

    it("removes the added atoms and leaves no orphan bond", async () => {
      // ac-003 (reverse half): coordinates, hydrogens and bonds come back as
      // one action.
      const kit = new Kit();
      const command = new StageOptimizeResultCommand(kit.app, growthPlan());

      await command.do();
      await command.undo();

      expect(kit.metaRegistry.atoms.allIds()).toEqual([0, 1, 2]);
      expect(kit.metaRegistry.atoms.editOnlyIds()).toEqual([]);
      const atomIds = new Set(kit.metaRegistry.atoms.allIds());
      for (const bondId of kit.metaRegistry.bonds.allIds()) {
        const meta = kit.metaRegistry.bonds.getMeta(bondId);
        if (!meta) throw new Error(`bond ${bondId} has no meta`);
        expect(atomIds.has(meta.atomId1)).toBe(true);
        expect(atomIds.has(meta.atomId2)).toBe(true);
      }
      expect(kit.metaRegistry.bonds.editOnlyIds()).toEqual([]);
    });

    it("paints exactly once and never rebuilds the scene", async () => {
      // ac-004, undo side: same non-call list, one flush for the whole undo.
      const kit = new Kit();
      const command = new StageOptimizeResultCommand(kit.app, growthPlan());
      await command.do();
      kit.highlighter.calls = 0;

      await command.undo();

      expect(kit.highlighter.calls).toBe(1);
      expect(kit.applyPipelineCalls).toBe(0);
      expect(kit.sceneIndex.registerAtomFrameCalls).toBe(0);
      expect(kit.sceneIndex.promoteFrameToEditPoolCalls).toBe(0);
      expect(kit.atomState.setFrameDataCalls).toBe(0);
      expect(kit.bondState.setFrameDataCalls).toBe(0);
    });

    it("refuses with a descriptive error before the command ran", async () => {
      // ac-005. The wrapper turns a synchronous throw into a rejection too, so
      // this passes only when the refusal is real — not when it is missing.
      const kit = new Kit();
      const command = new StageOptimizeResultCommand(kit.app, samePlan());

      const attempt = async (): Promise<unknown> => command.undo();
      const error = await attempt().then(
        () => null,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain("StageOptimizeResultCommand");
      expect(message).toMatch(/not been executed/i);
      // Nothing may have moved on the way to the refusal.
      expect(kit.sceneIndex.updateAtomCalls).toEqual([]);
      expect(kit.highlighter.calls).toBe(0);
    });
  });

  describe("redo", () => {
    it("replays the staged state without duplicating the added atoms", async () => {
      // A second do() after undo() is the manager's redo path
      // (PlaceMoleculeCommand's shape): the same two hydrogens come back with
      // the same ids, and the coordinates are the plan's again.
      const kit = new Kit();
      const command = new StageOptimizeResultCommand(kit.app, growthPlan());

      await command.do();
      await command.undo();
      await command.do();

      expect(kit.metaRegistry.atoms.editOnlyIds()).toEqual([3, 4]);
      expect(kit.metaRegistry.atoms.allIds()).toEqual([0, 1, 2, 3, 4]);
      for (let id = 0; id < BASE_ATOM_COUNT; id++) {
        const p = kit.position(id);
        expect(p.x).toBeCloseTo(PLAN_X[id], POSITION_DIGITS);
        expect(p.y).toBeCloseTo(PLAN_Y[id], POSITION_DIGITS);
        expect(p.z).toBeCloseTo(PLAN_Z[id], POSITION_DIGITS);
      }
    });

    it("never rebuilds the scene across do/undo/redo", async () => {
      // ac-004 in full: the forbidden four stay at zero for the whole cycle.
      const kit = new Kit();
      const command = new StageOptimizeResultCommand(kit.app, growthPlan());

      await command.do();
      await command.undo();
      await command.do();

      expect(kit.applyPipelineCalls).toBe(0);
      expect(kit.sceneIndex.registerAtomFrameCalls).toBe(0);
      expect(kit.sceneIndex.promoteFrameToEditPoolCalls).toBe(0);
      expect(kit.atomState.setFrameDataCalls).toBe(0);
      expect(kit.bondState.setFrameDataCalls).toBe(0);
      // One flush per action: do, undo, do.
      expect(kit.highlighter.calls).toBe(3);
    });
  });
});
