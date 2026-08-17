import type { Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { EditPoolPositions, ScenePaintTick } from "../src/edit_pool_positions";
import type { AtomMeta, BondMeta } from "../src/entity_source";

// Unit under test: stage/src/edit_pool_positions.ts (spec
// optimize-staging-01-positions). These cases pin the behaviour extracted
// verbatim from ManipulateMode's four private writers — the drag path is
// merely the first caller, so the goldens below are today's implicit contract.
//
// Every collaborator here is a STRUCTURAL fake: no Babylon mesh, no real
// SceneIndex, no MolvisApp. The production constructors must therefore accept
// the narrow surface these fakes implement (e.g.
// `Pick<SceneIndex, "meshRegistry" | "metaRegistry" | "topology" |
// "updateAtom" | "updateBond" | "bondPlaneAxis" | "markAllUnsaved">`), never
// the concrete `SceneIndex` class — passing these fakes must typecheck.
//
// The fake ImpostorState mirrors stage/tests/impostor_index_maps.test.ts:
// stride-16 `matrix` + stride-4 `instanceData` Float32Array buffers and the
// real getIndex / renderIndicesForLogicalId resolution order
// (frameIdToIndex → identity frame segment → idToIndex + frameOffset).

interface BufferDesc {
  data: Float32Array;
  stride: number;
}

interface BufferDef {
  name: string;
  stride: number;
}

/** Subset of ATOM_IMPOSTOR_SPEC.bufferDefs that the position writer touches. */
const ATOM_BUFFER_DEFS: readonly BufferDef[] = [
  { name: "matrix", stride: 16 },
  { name: "instanceData", stride: 4 },
];

/** Subset of BOND_IMPOSTOR_SPEC.bufferDefs; refreshBond only needs the mesh id. */
const BOND_BUFFER_DEFS: readonly BufferDef[] = [
  { name: "matrix", stride: 16 },
  { name: "instanceData0", stride: 4 },
  { name: "instanceData1", stride: 4 },
];

const CAPACITY = 16;

class FakeImpostorState {
  readonly mesh: { uniqueId: number };
  readonly buffers = new Map<string, BufferDesc>();
  frameOffset = 0;
  readonly frameIdToIndex = new Map<number, number>();
  readonly idToIndex = new Map<number, number>();
  readonly logicalToAllIndices = new Map<number, number[]>();
  readonly markDirtyCalls: string[][] = [];
  markAllDirtyCount = 0;

  constructor(uniqueId: number, defs: readonly BufferDef[]) {
    this.mesh = { uniqueId };
    for (const def of defs) {
      this.buffers.set(def.name, {
        data: new Float32Array(CAPACITY * def.stride),
        stride: def.stride,
      });
    }
  }

  /** Same resolution order as ImpostorState.getIndex. */
  getIndex(id: number): number | undefined {
    const frameIndex = this.frameIdToIndex.get(id);
    if (frameIndex !== undefined) return frameIndex;
    if (id < this.frameOffset) return id;
    const editIndex = this.idToIndex.get(id);
    if (editIndex === undefined) return undefined;
    return editIndex + this.frameOffset;
  }

  /** Same resolution order as ImpostorState.renderIndicesForLogicalId. */
  renderIndicesForLogicalId(id: number): number[] {
    const explicit = this.logicalToAllIndices.get(id);
    if (explicit) return explicit;
    const idx = this.getIndex(id);
    return idx !== undefined ? [idx] : [];
  }

  markDirty(...names: string[]): void {
    this.markDirtyCalls.push(names);
  }

  markAllDirty(): void {
    this.markAllDirtyCount += 1;
  }

  desc(name: string): BufferDesc {
    const desc = this.buffers.get(name);
    if (!desc) throw new Error(`fake buffer ${name} missing`);
    return desc;
  }
}

class FakeMeshRegistry {
  constructor(
    private readonly atoms: FakeImpostorState | null,
    private readonly bonds: FakeImpostorState | null,
  ) {}

  getAtomState(): FakeImpostorState | null {
    return this.atoms;
  }

  getBondState(): FakeImpostorState | null {
    return this.bonds;
  }
}

class FakeMetaSource<T> {
  private readonly metas = new Map<number, T>();

  set(id: number, meta: T): void {
    this.metas.set(id, meta);
  }

  getMeta(id: number): T | undefined {
    return this.metas.get(id);
  }
}

class FakeMetaRegistry {
  readonly atoms = new FakeMetaSource<AtomMeta>();
  readonly bonds = new FakeMetaSource<BondMeta>();
}

class FakeTopology {
  private readonly edges = new Map<number, [number, number]>();
  private readonly adjacency = new Map<number, number[]>();

  addBond(bondId: number, atom1: number, atom2: number): void {
    this.edges.set(bondId, [atom1, atom2]);
    for (const atom of [atom1, atom2]) {
      const bonds = this.adjacency.get(atom);
      if (bonds) bonds.push(bondId);
      else this.adjacency.set(atom, [bondId]);
    }
  }

  incident(atomId: number): number[] {
    return this.adjacency.get(atomId) ?? [];
  }

  endpoints(bondId: number): [number, number] | undefined {
    return this.edges.get(bondId);
  }

  neighbors(atomId: number): number[] {
    const out: number[] = [];
    for (const bondId of this.incident(atomId)) {
      const ends = this.edges.get(bondId);
      if (!ends) continue;
      out.push(ends[0] === atomId ? ends[1] : ends[0]);
    }
    return out;
  }
}

// Arity matters: SceneIndex.updateAtom(meshId, atomId, meta, bufferUpdates?)
// re-uploads every buffer (markAllDirty) when the 4th argument is present,
// which wipes the selection highlight mid-drag. Recording the raw argument
// tuple lets a test assert the 4th argument was never passed at all.
type UpdateAtomArgs = [
  meshId: number,
  atomId: number,
  meta: Partial<Omit<AtomMeta, "type">>,
  bufferUpdates?: Map<string, Float32Array>,
];

type UpdateBondArgs = [
  meshId: number,
  bondId: number,
  meta: Partial<Omit<BondMeta, "type">>,
  bufferUpdates?: Map<string, Float32Array>,
];

class FakeSceneIndex {
  readonly meshRegistry: FakeMeshRegistry;
  readonly metaRegistry = new FakeMetaRegistry();
  readonly topology = new FakeTopology();
  readonly updateAtomCalls: UpdateAtomArgs[] = [];
  readonly updateBondCalls: UpdateBondArgs[] = [];
  readonly bondPlaneAxisCalls: number[] = [];

  constructor(
    atoms: FakeImpostorState | null,
    bonds: FakeImpostorState | null,
    private readonly order: string[],
  ) {
    this.meshRegistry = new FakeMeshRegistry(atoms, bonds);
  }

  updateAtom(...args: UpdateAtomArgs): void {
    this.updateAtomCalls.push(args);
  }

  updateBond(...args: UpdateBondArgs): void {
    this.updateBondCalls.push(args);
  }

  /**
   * Geometry kernel stub. `bondPlaneAxis` + `buildSubBondInstanceBuffers` are
   * REUSED by the extraction, not rewritten, so this suite does not re-derive
   * the multi-bond offset math — it only pins that a rebuilt bond reaches
   * updateBond with its id and non-empty buffers.
   */
  bondPlaneAxis(
    atomId1: number,
    _position1: Vector3,
    atomId2: number,
    _position2: Vector3,
    _direction: Vector3,
    out: Vector3,
  ): void {
    this.bondPlaneAxisCalls.push(atomId1, atomId2);
    out.set(0, 0, 1);
  }

  markAllUnsaved(): void {
    this.order.push("markAllUnsaved");
  }
}

class FakeBondStyles {
  readonly getBondStyleCalls: number[] = [];

  constructor(private readonly radius: number) {}

  getBondStyle(sticks: number): { radius: number } {
    this.getBondStyleCalls.push(sticks);
    return { radius: this.radius };
  }
}

class FakePainter {
  constructor(private readonly order: string[]) {}

  applySceneIndexToMeshes(): void {
    this.order.push("applySceneIndexToMeshes");
  }
}

class FakeHighlighter {
  constructor(private readonly order: string[]) {}

  invalidateAndRebuild(): void {
    this.order.push("invalidateAndRebuild");
  }
}

interface Kit {
  order: string[];
  atomState: FakeImpostorState;
  bondState: FakeImpostorState;
  sceneIndex: FakeSceneIndex;
  bondStyles: FakeBondStyles;
}

const ATOM_MESH_ID = 11;
const BOND_MESH_ID = 22;
const BOND_RADIUS = 0.15;

function makeKit(): Kit {
  const order: string[] = [];
  const atomState = new FakeImpostorState(ATOM_MESH_ID, ATOM_BUFFER_DEFS);
  const bondState = new FakeImpostorState(BOND_MESH_ID, BOND_BUFFER_DEFS);
  return {
    order,
    atomState,
    bondState,
    sceneIndex: new FakeSceneIndex(atomState, bondState, order),
    bondStyles: new FakeBondStyles(BOND_RADIUS),
  };
}

function atomMeta(atomId: number, x: number, y: number, z: number): AtomMeta {
  return { type: "atom", atomId, element: "C", position: { x, y, z } };
}

function singleBondMeta(
  bondId: number,
  atomId1: number,
  atomId2: number,
): BondMeta {
  return {
    type: "bond",
    bondId,
    atomId1,
    atomId2,
    bondType: 1,
    bondNumber: 1,
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 0, z: 0 },
  };
}

describe("TestEditPoolPositions", () => {
  describe("writeAtom", () => {
    it("writes translation + xyz of a frame-segment atom (identity mapping)", () => {
      const kit = makeKit();
      kit.atomState.frameOffset = 8; // ids 0..7 map to rows 0..7
      const writer = new EditPoolPositions(kit.sceneIndex, kit.bondStyles);

      writer.writeAtom(3, 1.5, -2.25, 0.5);

      // 1.5 / -2.25 / 0.5 are exact in float32, so exact equality is valid.
      const matrix = kit.atomState.desc("matrix").data;
      expect(matrix[3 * 16 + 12]).toBe(1.5);
      expect(matrix[3 * 16 + 13]).toBe(-2.25);
      expect(matrix[3 * 16 + 14]).toBe(0.5);

      const instanceData = kit.atomState.desc("instanceData").data;
      expect(instanceData[3 * 4 + 0]).toBe(1.5);
      expect(instanceData[3 * 4 + 1]).toBe(-2.25);
      expect(instanceData[3 * 4 + 2]).toBe(0.5);
    });

    it("resolves an edit-pool atom through idToIndex + frameOffset", () => {
      const kit = makeKit();
      // ac-002 fixture: logical id 7 -> edit index 2, frameOffset 5 -> row 7.
      kit.atomState.frameOffset = 5;
      kit.atomState.idToIndex.set(7, 2);
      const writer = new EditPoolPositions(kit.sceneIndex, kit.bondStyles);

      writer.writeAtom(7, 1.5, -2.25, 0.5);

      const matrix = kit.atomState.desc("matrix").data;
      expect(matrix[7 * 16 + 12]).toBe(1.5);
      expect(matrix[7 * 16 + 13]).toBe(-2.25);
      expect(matrix[7 * 16 + 14]).toBe(0.5);
      // The raw edit index (2) is NOT a render row — dropping frameOffset
      // would corrupt a frame atom instead of moving the edited one.
      expect(matrix[2 * 16 + 12]).toBe(0);
      expect(matrix[2 * 16 + 13]).toBe(0);
      expect(matrix[2 * 16 + 14]).toBe(0);
    });

    it("ignores an unmapped id: no buffer mutation, no throw", () => {
      const kit = makeKit();
      kit.atomState.frameOffset = 3;
      kit.atomState.idToIndex.set(7, 2);
      const writer = new EditPoolPositions(kit.sceneIndex, kit.bondStyles);
      const matrixBefore = kit.atomState.desc("matrix").data.slice();
      const dataBefore = kit.atomState.desc("instanceData").data.slice();

      // id 4 is neither a frame row (< 3) nor an edit-pool key.
      expect(() => {
        writer.writeAtom(4, 1.5, -2.25, 0.5);
      }).not.toThrow();

      expect(Array.from(kit.atomState.desc("matrix").data)).toEqual(
        Array.from(matrixBefore),
      );
      expect(Array.from(kit.atomState.desc("instanceData").data)).toEqual(
        Array.from(dataBefore),
      );
      expect(kit.atomState.markDirtyCalls).toEqual([]);
      expect(kit.sceneIndex.updateAtomCalls).toEqual([]);
    });

    it("marks only matrix + instanceData dirty, never all buffers", () => {
      const kit = makeKit();
      kit.atomState.frameOffset = 8;
      const writer = new EditPoolPositions(kit.sceneIndex, kit.bondStyles);

      writer.writeAtom(3, 1.5, -2.25, 0.5);

      expect(kit.atomState.markDirtyCalls).toEqual([
        ["matrix", "instanceData"],
      ]);
      expect(kit.atomState.markAllDirtyCount).toBe(0);
    });

    it("calls updateAtom meta-only, with no bufferUpdates argument", () => {
      const kit = makeKit();
      kit.atomState.frameOffset = 8;
      const writer = new EditPoolPositions(kit.sceneIndex, kit.bondStyles);

      writer.writeAtom(3, 1.5, -2.25, 0.5);

      expect(kit.sceneIndex.updateAtomCalls.length).toBe(1);
      const call = kit.sceneIndex.updateAtomCalls[0];
      expect(call[0]).toBe(ATOM_MESH_ID);
      expect(call[1]).toBe(3);
      expect(call[2]).toEqual({ position: { x: 1.5, y: -2.25, z: 0.5 } });
      // Passing buffer maps routes into updateMulti -> markAllDirty, which
      // re-uploads colors and wipes the selection highlight mid-drag.
      expect(call.length).toBe(3);
      expect(call[3]).toBeUndefined();
    });

    it("preserves matrix scale slots and the instance radius", () => {
      const kit = makeKit();
      kit.atomState.frameOffset = 8;
      const matrix = kit.atomState.desc("matrix").data;
      const instanceData = kit.atomState.desc("instanceData").data;
      matrix[3 * 16 + 0] = 1.25;
      matrix[3 * 16 + 5] = 1.25;
      matrix[3 * 16 + 10] = 1.25;
      instanceData[3 * 4 + 3] = 0.77;
      const scaleX = matrix[3 * 16 + 0];
      const scaleY = matrix[3 * 16 + 5];
      const scaleZ = matrix[3 * 16 + 10];
      const radius = instanceData[3 * 4 + 3];
      const writer = new EditPoolPositions(kit.sceneIndex, kit.bondStyles);

      writer.writeAtom(3, 1.5, -2.25, 0.5);

      expect(matrix[3 * 16 + 0]).toBe(scaleX);
      expect(matrix[3 * 16 + 5]).toBe(scaleY);
      expect(matrix[3 * 16 + 10]).toBe(scaleZ);
      expect(instanceData[3 * 4 + 3]).toBe(radius);
    });
  });

  describe("refreshBond", () => {
    it("rebuilds one bond from endpoint meta into updateBond", () => {
      const kit = makeKit();
      kit.atomState.frameOffset = 8;
      kit.sceneIndex.topology.addBond(0, 0, 1);
      kit.sceneIndex.metaRegistry.atoms.set(0, atomMeta(0, 0, 0, 0));
      kit.sceneIndex.metaRegistry.atoms.set(1, atomMeta(1, 1.5, 0, 0));
      kit.sceneIndex.metaRegistry.bonds.set(0, singleBondMeta(0, 0, 1));
      const writer = new EditPoolPositions(kit.sceneIndex, kit.bondStyles);

      writer.refreshBond(0);

      expect(kit.sceneIndex.updateBondCalls.length).toBe(1);
      const call = kit.sceneIndex.updateBondCalls[0];
      expect(call[0]).toBe(BOND_MESH_ID);
      expect(call[1]).toBe(0);
      expect(call[2]).toEqual({
        start: { x: 0, y: 0, z: 0 },
        end: { x: 1.5, y: 0, z: 0 },
      });
      // The offset/geometry math stays in bondPlaneAxis +
      // buildSubBondInstanceBuffers (reused, not re-derived here), so the
      // golden stops at "non-empty rebuilt buffers reached updateBond".
      const buffers = call[3];
      expect(buffers).toBeDefined();
      expect((buffers?.get("matrix")?.length ?? 0) > 0).toBe(true);
      // Radius comes from the narrow BondRadiusSource, keyed by stick count.
      expect(kit.bondStyles.getBondStyleCalls).toEqual([1]);
    });
  });

  describe("refreshBondsAround", () => {
    it("rebuilds a bond whose two endpoints both moved exactly once", () => {
      const kit = makeKit();
      kit.atomState.frameOffset = 8;
      kit.sceneIndex.topology.addBond(0, 0, 1);
      kit.sceneIndex.metaRegistry.atoms.set(0, atomMeta(0, 0, 0, 0));
      kit.sceneIndex.metaRegistry.atoms.set(1, atomMeta(1, 1.5, 0, 0));
      kit.sceneIndex.metaRegistry.bonds.set(0, singleBondMeta(0, 0, 1));
      const writer = new EditPoolPositions(kit.sceneIndex, kit.bondStyles);

      writer.refreshBondsAround([0, 1]);

      expect(kit.sceneIndex.updateBondCalls.length).toBe(1);
      expect(kit.sceneIndex.updateBondCalls[0][1]).toBe(0);
    });
  });
});

describe("TestScenePaintTick", () => {
  describe("flush", () => {
    it("paints, then dirties, then rebuilds the highlight — once each", () => {
      const kit = makeKit();
      const painter = new FakePainter(kit.order);
      const highlighter = new FakeHighlighter(kit.order);
      const tick = new ScenePaintTick(painter, kit.sceneIndex, highlighter);

      tick.flush();

      // Order is semantic: bond rebuilds dirty the color buffers, so the
      // highlight must be rebuilt AFTER the upload or a drag looks like a
      // deselect.
      expect(kit.order).toEqual([
        "applySceneIndexToMeshes",
        "markAllUnsaved",
        "invalidateAndRebuild",
      ]);
    });
  });
});
