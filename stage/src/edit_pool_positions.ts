import { Vector3 } from "@babylonjs/core";
import { buildSubBondInstanceBuffers } from "./artist/bond_buffer";
import type { AtomMeta, BondMeta } from "./entity_source";
import { displayBondOrder } from "./utils/bond_order";

/**
 * @file Edit-pool position writing and the one-shot GPU upload tick.
 *
 * @description
 * The single legal write path for "an atom moved" on the live scene:
 * resolve logical id -> render index, rewrite **only** the translation and
 * xyz slots of the impostor buffers, mark those two buffers dirty, rebuild
 * every incident bond once, then upload once. Extracted verbatim from
 * {@link ManipulateMode}'s former private writers (spec
 * `optimize-staging-01-positions`); the drag path is merely the first caller.
 *
 * **Units.** Every coordinate crossing this module — `writeAtom`'s `x`/`y`/`z`,
 * atom `meta.position`, bond `start`/`end`, and the bond radius taken from
 * {@link BondRadiusSource} — is in angstrom (Å), the scene's world unit. No
 * scaling happens here.
 *
 * **Deliberate non-calls.** {@link EditPoolPositions} never calls
 * `SceneIndex.registerAtomFrame`, `ImpostorState.setFrameData`, or
 * `Pipeline.applyPipeline`. The first two reset `frameOffset` and wipe the
 * edit pool — every id this module just resolved would dangle — and the third
 * recomputes the frame from its sources, discarding the in-flight edit. A
 * position write is a buffer patch, never a scene rebuild.
 *
 * Collaborators enter as narrow structural protocols (never the concrete
 * `SceneIndex` / `MolvisApp`) so both classes are unit-testable with plain
 * fakes.
 */

/** One impostor buffer: its backing float storage plus per-instance stride. */
interface ImpostorBuffer {
  data: Float32Array;
  stride: number;
}

/**
 * The slice of `ImpostorState` a position write touches: the mesh identity, the
 * raw CPU buffers, the logical-id -> render-index map, and the partial dirty
 * lane.
 */
interface ImpostorPositionTarget {
  readonly mesh: { readonly uniqueId: number };
  readonly buffers: Map<string, ImpostorBuffer>;
  renderIndicesForLogicalId(id: number): number[];
  markDirty(...names: string[]): void;
}

/** Meta lookup for one entity kind; `null` and `undefined` both mean absent. */
interface MetaLookup<T> {
  getMeta(id: number): T | null | undefined;
}

/** The bond graph queries a position write needs — no mutation. */
interface BondTopology {
  incident(atomId: number): number[];
  endpoints(bondId: number): [number, number] | undefined;
}

/**
 * The narrow `SceneIndex` surface {@link EditPoolPositions} drives. Typed
 * structurally so the unit tests can pass fakes; the real `SceneIndex`
 * satisfies it as-is.
 */
export interface EditPoolScene {
  readonly meshRegistry: {
    getAtomState(): ImpostorPositionTarget | null;
    getBondState(): ImpostorPositionTarget | null;
  };
  readonly metaRegistry: {
    readonly atoms: MetaLookup<AtomMeta>;
    readonly bonds: MetaLookup<BondMeta>;
  };
  readonly topology: BondTopology;
  updateAtom(
    meshId: number,
    atomId: number,
    meta: Partial<Omit<AtomMeta, "type">>,
    bufferUpdates?: Map<string, Float32Array>,
  ): void;
  updateBond(
    meshId: number,
    bondId: number,
    meta: Partial<Omit<BondMeta, "type">>,
    bufferUpdates?: Map<string, Float32Array>,
  ): void;
  bondPlaneAxis(
    atomId1: number,
    position1: Vector3,
    atomId2: number,
    position2: Vector3,
    direction: Vector3,
    out: Vector3,
  ): void;
}

/**
 * Bond stick radius (Å) by stick count. Only the radius is needed, so the
 * whole `StyleManager` stays out of this module's coupling surface.
 */
export interface BondRadiusSource {
  getBondStyle(sticks: number): { radius: number };
}

/** Fallback bond radius (Å) when a bond has no meta to style from. */
const FALLBACK_BOND_RADIUS = 0.1;

/**
 * Writes atom positions into the live edit pool's CPU impostor buffers.
 *
 * @description
 * Construct once per attach (never per frame), then per gesture tick:
 * `writeAtom` every moved atom, `refreshBondsAround` their ids once, and let
 * a {@link ScenePaintTick} upload. Nothing here touches the GPU, the frame
 * data, or the pipeline — see the file docstring for the non-call list.
 *
 * @example
 * ```ts
 * const positions = new EditPoolPositions(world.sceneIndex, app.styleManager);
 * for (const [atomId, p] of moved) positions.writeAtom(atomId, p.x, p.y, p.z);
 * positions.refreshBondsAround(moved.keys());
 * paintTick.flush();
 * ```
 */
export class EditPoolPositions {
  /**
   * @param scene Live scene registry (meshes, meta, topology) to write into.
   * @param bondStyles Source of bond stick radii (Å) for rebuilt bonds.
   */
  constructor(
    private readonly scene: EditPoolScene,
    private readonly bondStyles: BondRadiusSource,
  ) {}

  /**
   * Move one atom to (`x`, `y`, `z`), rewriting **position only**.
   *
   * @description
   * The render row comes from `renderIndicesForLogicalId` — after any
   * atom add/remove the edit pool's id -> row mapping is no longer the
   * identity, so a raw id would corrupt an unrelated instance. Matrix scale
   * (`matrix[0/5/10]`) and instance radius (`instanceData[3]`) are left
   * untouched, so dragging never resizes an atom.
   *
   * Meta is refreshed through `updateAtom` **without** a `bufferUpdates`
   * argument on purpose: passing buffer maps routes into `updateMulti`, whose
   * `markAllDirty` re-uploads the color buffers and wipes the selection
   * highlight mid-drag. Only `matrix` and `instanceData` are marked dirty here.
   *
   * Does not touch bonds and does not upload — batch atoms, then call
   * {@link refreshBondsAround} once, then {@link ScenePaintTick.flush} once.
   *
   * @param atomId Logical atom id (frame segment or edit pool).
   * @param x New x coordinate, Å.
   * @param y New y coordinate, Å.
   * @param z New z coordinate, Å.
   * @returns Nothing; an unmapped `atomId` is a silent no-op.
   */
  writeAtom(atomId: number, x: number, y: number, z: number): void {
    const atomState = this.scene.meshRegistry.getAtomState();
    if (!atomState) return;
    const meshId = atomState.mesh.uniqueId;

    const indices = atomState.renderIndicesForLogicalId(atomId);
    const idx = indices[0];
    if (idx === undefined) return;

    const matDesc = atomState.buffers.get("matrix");
    const dataDesc = atomState.buffers.get("instanceData");
    if (!matDesc || !dataDesc) return;

    // Slots 12..14 are the translation column of the column-major instance
    // matrix; 0/5/10 hold the scale and are deliberately skipped.
    const m = idx * matDesc.stride;
    matDesc.data[m + 12] = x;
    matDesc.data[m + 13] = y;
    matDesc.data[m + 14] = z;

    // instanceData packs (x, y, z, radius) — write xyz, keep the radius.
    const d = idx * dataDesc.stride;
    dataDesc.data[d] = x;
    dataDesc.data[d + 1] = y;
    dataDesc.data[d + 2] = z;

    atomState.markDirty("matrix", "instanceData");

    this.scene.updateAtom(meshId, atomId, { position: { x, y, z } });
  }

  /**
   * Rebuild every bond incident to `atomIds`, each bond exactly once.
   *
   * @description
   * Ids are collected into a set first, so a bond whose two endpoints both
   * moved is rebuilt once per tick rather than once per endpoint. Endpoint
   * positions are read from atom meta, which {@link writeAtom} has already
   * updated — this must therefore run **after** every atom write of the
   * current tick.
   *
   * @param atomIds Logical ids of the atoms that moved this tick.
   * @returns Nothing.
   */
  refreshBondsAround(atomIds: Iterable<number>): void {
    const bondIds = new Set<number>();
    for (const atomId of atomIds) {
      for (const bondId of this.scene.topology.incident(atomId)) {
        bondIds.add(bondId);
      }
    }
    for (const bondId of bondIds) {
      this.refreshBond(bondId);
    }
  }

  /**
   * Rebuild one bond's instance buffers from its endpoints' current meta.
   *
   * @description
   * The multi-stick offset geometry stays in `bondPlaneAxis` +
   * `buildSubBondInstanceBuffers`; this method only feeds them the endpoint
   * positions (Å) and the styled radius (Å), then hands the rebuilt buffers to
   * `updateBond`. Colors are placeholders — the bond's real colors are already
   * resident in its buffers and are not re-derived by a move.
   *
   * @param bondId Logical bond id to rebuild.
   * @returns Nothing; a bond with no mesh, no endpoints or missing endpoint
   * meta is a silent no-op.
   */
  refreshBond(bondId: number): void {
    const bondState = this.scene.meshRegistry.getBondState();
    if (!bondState) return;

    const endpoints = this.scene.topology.endpoints(bondId);
    if (!endpoints) return;
    const [atom1, atom2] = endpoints;
    const meta1 = this.scene.metaRegistry.atoms.getMeta(atom1);
    const meta2 = this.scene.metaRegistry.atoms.getMeta(atom2);
    if (!meta1 || !meta2) return;

    const p1 = new Vector3(
      meta1.position.x,
      meta1.position.y,
      meta1.position.z,
    );
    const p2 = new Vector3(
      meta2.position.x,
      meta2.position.y,
      meta2.position.z,
    );

    const bondMeta = this.scene.metaRegistry.bonds.getMeta(bondId);
    const sticks = bondMeta
      ? displayBondOrder(bondMeta.bondType, bondMeta.bondNumber)
      : 1;
    const bondRadius = bondMeta
      ? this.bondStyles.getBondStyle(sticks).radius
      : FALLBACK_BOND_RADIUS;

    const offsetAxis = new Vector3();
    this.scene.bondPlaneAxis(
      atom1,
      p1,
      atom2,
      p2,
      p2.subtract(p1).normalize(),
      offsetAxis,
    );

    const placeholderColor = new Float32Array(4);
    const { buffers: subBuffers } = buildSubBondInstanceBuffers(
      p1,
      p2,
      sticks,
      bondRadius,
      placeholderColor,
      placeholderColor,
      0,
      offsetAxis,
    );

    const updates = new Map<string, Float32Array>();
    const matrix = subBuffers.get("matrix");
    const data0 = subBuffers.get("instanceData0");
    const data1 = subBuffers.get("instanceData1");
    if (matrix) updates.set("matrix", matrix);
    if (data0) updates.set("instanceData0", data0);
    if (data1) updates.set("instanceData1", data1);

    this.scene.updateBond(
      bondState.mesh.uniqueId,
      bondId,
      {
        start: { x: p1.x, y: p1.y, z: p1.z },
        end: { x: p2.x, y: p2.y, z: p2.z },
      },
      updates,
    );
  }
}

/** Uploads the scene's dirty impostor buffers to the GPU. */
export interface SceneMeshPainter {
  applySceneIndexToMeshes(): void;
}

/** Flags the scene as holding uncommitted edits. */
export interface SceneDirtyMarker {
  markAllUnsaved(): void;
}

/** Re-derives the selection highlight overlay from current buffers. */
export interface HighlightInvalidator {
  invalidateAndRebuild(): void;
}

/**
 * One GPU upload for a batch of edit-pool writes.
 *
 * @description
 * {@link EditPoolPositions} only mutates CPU arrays and dirty flags; without a
 * `flush` the canvas never moves. Construct once per attach and call once per
 * gesture tick, after all atom writes and bond rebuilds.
 *
 * @example
 * ```ts
 * const paintTick = new ScenePaintTick(app.artist, world.sceneIndex, world.highlighter);
 * paintTick.flush();
 * ```
 */
export class ScenePaintTick {
  /**
   * @param painter Uploader for dirty impostor buffers.
   * @param scene Dirty-state owner, flagged unsaved after the upload.
   * @param highlighter Selection highlight, rebuilt last.
   */
  constructor(
    private readonly painter: SceneMeshPainter,
    private readonly scene: SceneDirtyMarker,
    private readonly highlighter: HighlightInvalidator,
  ) {}

  /**
   * Upload, flag unsaved, rebuild the highlight — in that order.
   *
   * @description
   * The order is semantic, not incidental: bond rebuilds dirty the color
   * buffers, so the highlight has to be rebuilt **after** the upload or a drag
   * renders as a deselect.
   *
   * @returns Nothing.
   */
  flush(): void {
    this.painter.applySceneIndexToMeshes();
    this.scene.markAllUnsaved();
    this.highlighter.invalidateAndRebuild();
  }
}
