import type { Mesh } from "@babylonjs/core";
import type { Block, Frame } from "@molcrafts/molrs";
import { ATOM_IMPOSTOR_SPEC, BOND_IMPOSTOR_SPEC } from "./artist/material_spec";
import {
  type AtomMeta,
  type BondMeta,
  type BoxMeta,
  type EntityMeta,
  type EntityType,
  MetaRegistry,
} from "./entity_source";
import { encodePickingColor } from "./picker";
import { makeSelectionKey } from "./selection_manager";
import { Topology } from "./system/topology";

// ============ Registration Options ============

export interface RegisterAtomFrameOptions {
  /**
   * Owning Frame for the registered atom data. MetaRegistry stores this
   * reference and re-derives Block handles on every read so they survive
   * `frame.setMeta` invalidations (see entity_source.ts header).
   */
  frame: Frame;
  mesh: Mesh;
  block: Block;
  buffers: Map<string, Float32Array>;
}

export interface RegisterBondFrameOptions {
  frame: Frame;
  mesh: Mesh;
  block: Block;
  buffers: Map<string, Float32Array>;
  /** Total bond render instances (may exceed block.nrows() for multi-order bonds). */
  instanceCount?: number;
  /** Optional render-instance → logical bond-id map. */
  instanceMap?: Uint32Array;
}

export interface RegisterAtomOptions {
  mesh: Mesh;
  meta: Omit<AtomMeta, "type">;
}

export interface RegisterBondOptions {
  mesh: Mesh;
  meta: Omit<BondMeta, "type">;
}

export interface RegisterBoxOptions {
  mesh: Mesh;
  meta: Omit<BoxMeta, "type">;
}

// ============ Impostor State ============

/**
 * Manages GPU buffers for thin instances in a unified buffer layout:
 * [0..frameOffset) = frame data, [frameOffset..frameOffset+count) = edit data.
 */
export class ImpostorState {
  public count = 0; // Number of EDIT atoms (added on top of frame)
  public capacity: number;
  public frameOffset = 0; // Number of FRAME atoms

  // Per-buffer dirty tracking. `_allDirty` forces a full re-upload (first draw,
  // topology/count change, color change). Otherwise only `_dirtyBuffers` are
  // re-uploaded — the position-only playback path mutates just matrix +
  // instanceData and must NOT re-upload the unchanged color/picking buffers
  // (the per-frame GPU-bandwidth hog for large systems).
  private _allDirty = false;
  private _dirtyBuffers = new Set<string>();
  // True when the frame segment uses identity mapping (no frameInstanceMap):
  // logicalId === render index. In that case frameIdToIndex/logicalToAllIndices
  // are left empty and the accessors synthesize identity on demand — avoiding
  // frameCount Map insertions + frameCount single-element arrays per full draw.
  private _frameMapIdentity = false;
  public frameIdToIndex = new Map<number, number>();
  /** All render instance indices per logical ID (for multi-order bonds). */
  public logicalToAllIndices = new Map<number, number[]>();

  public buffers = new Map<string, { data: Float32Array; stride: number }>();

  // Mapping for EDIT atoms only: ID -> EditIndex (0..count-1)
  public idToIndex = new Map<number, number>();
  public indexToId = new Map<number, number>();

  constructor(
    public mesh: Mesh,
    bufferDefs: Array<{ name: string; stride: number }>,
    initialCapacity = 64,
  ) {
    this.capacity = initialCapacity;
    for (const def of bufferDefs) {
      this.buffers.set(def.name, {
        data: new Float32Array(this.capacity * def.stride),
        stride: def.stride,
      });
    }
  }

  setFrameData(
    buffers: Map<string, Float32Array>,
    frameCount: number,
    frameInstanceMap?: Uint32Array,
  ): void {
    this.frameOffset = frameCount;
    this.count = 0;
    this.idToIndex.clear();
    this.indexToId.clear();
    this.frameIdToIndex.clear();
    this.logicalToAllIndices.clear();

    // 1. Ensure capacity
    if (this.capacity < frameCount) {
      this.capacity = Math.max(frameCount * 2, 64);
      for (const [_, desc] of this.buffers) {
        const newData = new Float32Array(this.capacity * desc.stride);
        desc.data = newData;
      }
    }

    const hasPreBuiltPicking = buffers.has("instancePickingColor");

    for (const [name, data] of buffers) {
      const desc = this.buffers.get(name);
      if (desc) {
        desc.data.set(
          data.length <= desc.data.length
            ? data
            : data.subarray(0, desc.data.length),
        );
      }
    }

    // Only re-encode picking colors when the caller did NOT supply them.
    // buildAtomBuffers/buildBondBuffers encode correct logical IDs into picking
    // colors; overwriting them here would destroy the logical-bond-ID mapping
    // for multi-order bonds (where render instance != logical bond index).
    if (!hasPreBuiltPicking) {
      const pickBuf = this.buffers.get("instancePickingColor");
      if (pickBuf) {
        for (let i = 0; i < frameCount; i++) {
          const pCol = encodePickingColor(this.mesh.uniqueId, i);
          const offset = i * 4;
          pickBuf.data.set(pCol, offset);
        }
      }
    }

    // Index maps are only needed when render index != logical id, i.e. for
    // multi-order bonds (frameInstanceMap present). Without it the mapping is
    // identity; skip building both maps and let the accessors + getIndex()
    // synthesize identity. This avoids frameCount Map insertions + frameCount
    // single-element arrays on every full draw.
    if (frameInstanceMap) {
      this._frameMapIdentity = false;
      for (let i = 0; i < frameCount; i++) {
        const logicalId = frameInstanceMap[i];
        if (!this.frameIdToIndex.has(logicalId)) {
          this.frameIdToIndex.set(logicalId, i);
        }
        // Store ALL render indices per logical ID (multi-order bonds).
        const group = this.logicalToAllIndices.get(logicalId);
        if (group) {
          group.push(i);
        } else {
          this.logicalToAllIndices.set(logicalId, [i]);
        }
      }
    } else {
      this._frameMapIdentity = true;
    }

    this.markAllDirty();
  }

  getStride(name: string): number {
    return this.buffers.get(name)?.stride ?? 4;
  }

  getIdByIndex(bufferIndex: number): number | undefined {
    // bufferIndex is absolute index.
    if (bufferIndex < this.frameOffset) return bufferIndex; // Implicit Frame ID

    const editIndex = bufferIndex - this.frameOffset;
    if (editIndex < 0 || editIndex >= this.count) return undefined;
    return this.indexToId.get(editIndex);
  }

  getIndex(id: number): number | undefined {
    const frameIndex = this.frameIdToIndex.get(id);
    if (frameIndex !== undefined) return frameIndex;
    if (id < this.frameOffset) return id; // Implicit Frame Index

    const editIndex = this.idToIndex.get(id);
    if (editIndex === undefined) return undefined;
    return editIndex + this.frameOffset;
  }

  /**
   * All render-instance indices for a logical id. Multi-instance entities
   * (multi-order bonds) are tracked explicitly in `logicalToAllIndices`;
   * single-instance entities resolve through getIndex() (identity for the
   * frame segment, edit-table for edits), so they need no stored array.
   */
  renderIndicesForLogicalId(id: number): number[] {
    const explicit = this.logicalToAllIndices.get(id);
    if (explicit) return explicit;
    const idx = this.getIndex(id);
    return idx !== undefined ? [idx] : [];
  }

  /** Iterate `[logicalId, firstRenderIndex]` over the frame segment. */
  *frameLogicalIds(): IterableIterator<[number, number]> {
    if (this._frameMapIdentity) {
      for (let i = 0; i < this.frameOffset; i++) yield [i, i];
    } else {
      yield* this.frameIdToIndex;
    }
  }

  /** Iterate `[logicalId, allRenderIndices]` over the frame segment. */
  *frameLogicalToRenderEntries(): IterableIterator<[number, number[]]> {
    if (this._frameMapIdentity) {
      for (let i = 0; i < this.frameOffset; i++) yield [i, [i]];
    } else {
      yield* this.logicalToAllIndices;
    }
  }

  /**
   * Append one logical entity occupying `subCount` contiguous render slots.
   * Caller-provided `values` must be sized `stride * subCount` per buffer.
   * For subCount > 1 the entity is registered in `logicalToAllIndices` so
   * picking, removal, and selection treat the N slots as one logical id —
   * mirroring how frame-mode multi-order bonds are laid out.
   */
  append(
    id: number,
    values: Map<string, Float32Array | number[]>,
    subCount = 1,
  ): number {
    if (this.idToIndex.has(id)) throw new Error(`Duplicate ID ${id}`);
    while (this.frameOffset + this.count + subCount > this.capacity) {
      this.grow();
    }

    const firstEditIndex = this.count;
    const firstAbsIndex = this.frameOffset + firstEditIndex;

    for (const [name, desc] of this.buffers) {
      const vals = values.get(name);
      if (vals) {
        const arr =
          vals instanceof Float32Array ? vals : new Float32Array(vals);
        desc.data.set(arr, firstAbsIndex * desc.stride);
      }
    }

    for (let s = 0; s < subCount; s++) {
      this.writePickingColor(firstEditIndex + s, firstAbsIndex + s);
      this.indexToId.set(firstEditIndex + s, id);
    }
    this.idToIndex.set(id, firstEditIndex);

    if (subCount > 1) {
      const all: number[] = [];
      for (let s = 0; s < subCount; s++) all.push(firstAbsIndex + s);
      this.logicalToAllIndices.set(id, all);
    }

    this.count += subCount;
    this.markAllDirty();
    return firstAbsIndex;
  }

  /**
   * Number of contiguous render slots an edit-space id occupies.
   * 1 for single-order bonds / atoms; N for multi-order bonds.
   */
  private editSubCount(id: number): number {
    const all = this.logicalToAllIndices.get(id);
    return all ? all.length : 1;
  }

  read(id: number, bufferName: string): Float32Array | null {
    let absIndex = -1;
    if (id < this.frameOffset) {
      absIndex = id;
    } else {
      const editIndex = this.idToIndex.get(id);
      if (editIndex !== undefined) {
        absIndex = this.frameOffset + editIndex;
      }
    }

    if (absIndex === -1) return null;

    const desc = this.buffers.get(bufferName);
    if (!desc) return null;

    if (absIndex * desc.stride >= desc.data.length) return null;

    const start = absIndex * desc.stride;
    return desc.data.subarray(start, start + desc.stride);
  }

  /**
   * Like `read` but returns all N contiguous slots belonging to this
   * logical id (1 for single-instance entities, >1 for multi-order bonds).
   * Used by DeleteBondCommand to snapshot every sub-instance before removal.
   */
  readAll(id: number, bufferName: string): Float32Array | null {
    let firstAbs = -1;
    let subCount = 1;
    const editIndex = this.idToIndex.get(id);
    if (editIndex !== undefined) {
      firstAbs = this.frameOffset + editIndex;
      subCount = this.editSubCount(id);
    } else if (id < this.frameOffset) {
      firstAbs = id;
      const all = this.logicalToAllIndices.get(id);
      if (all) subCount = all.length;
    }
    if (firstAbs === -1) return null;

    const desc = this.buffers.get(bufferName);
    if (!desc) return null;
    const start = firstAbs * desc.stride;
    const end = start + subCount * desc.stride;
    if (end > desc.data.length) return null;
    return desc.data.subarray(start, end);
  }

  /**
   * Remove a logical id, freeing all its contiguous render slots.
   * For single-slot ids this degenerates to the old swap-with-last behavior
   * via the same shift-down pass; for multi-slot ids (order > 1 bonds) the
   * whole block is evicted and tail entries shift to fill the gap.
   */
  remove(id: number): void {
    const firstEditIndex = this.idToIndex.get(id);
    if (firstEditIndex === undefined) return;

    const subCount = this.editSubCount(id);
    const firstAbsIndex = this.frameOffset + firstEditIndex;
    const tailSrcAbs = firstAbsIndex + subCount;
    const totalAbs = this.frameOffset + this.count;
    const tailRenderSlots = totalAbs - tailSrcAbs;

    if (tailRenderSlots > 0) {
      for (const [, desc] of this.buffers) {
        const dstStart = firstAbsIndex * desc.stride;
        const srcStart = tailSrcAbs * desc.stride;
        const byteLen = tailRenderSlots * desc.stride;
        desc.data.copyWithin(dstStart, srcStart, srcStart + byteLen);
      }
    }

    this.idToIndex.delete(id);
    this.logicalToAllIndices.delete(id);
    for (let s = 0; s < subCount; s++) {
      this.indexToId.delete(firstEditIndex + s);
    }

    // Shift every displaced id/block down by subCount.
    const affectedIds: number[] = [];
    for (const [otherId, otherEditIdx] of this.idToIndex) {
      if (otherEditIdx > firstEditIndex) affectedIds.push(otherId);
    }
    // Process in ascending order so indexToId cleanup never clobbers a slot
    // that still belongs to an unshifted entry.
    affectedIds.sort(
      (a, b) => (this.idToIndex.get(a) ?? 0) - (this.idToIndex.get(b) ?? 0),
    );
    for (const otherId of affectedIds) {
      const oldEditIdx = this.idToIndex.get(otherId);
      if (oldEditIdx === undefined) continue;
      const newEditIdx = oldEditIdx - subCount;
      const otherSubCount = this.editSubCount(otherId);

      for (let s = 0; s < otherSubCount; s++) {
        this.indexToId.delete(oldEditIdx + s);
      }
      this.idToIndex.set(otherId, newEditIdx);
      for (let s = 0; s < otherSubCount; s++) {
        this.indexToId.set(newEditIdx + s, otherId);
      }

      const oldAbs = this.logicalToAllIndices.get(otherId);
      if (oldAbs) {
        this.logicalToAllIndices.set(
          otherId,
          oldAbs.map((a) => a - subCount),
        );
      }

      // Picking colors encode absIndex — rewrite for the moved block.
      const newAbsBase = this.frameOffset + newEditIdx;
      for (let s = 0; s < otherSubCount; s++) {
        this.writePickingColor(newEditIdx + s, newAbsBase + s);
      }
    }

    this.count -= subCount;
    this.markAllDirty();
  }

  updateMulti(id: number, values: Map<string, Float32Array | number[]>): void {
    let absIndex = -1;
    if (id < this.frameOffset) {
      absIndex = id;
    } else {
      const editIndex = this.idToIndex.get(id);
      if (editIndex !== undefined) {
        absIndex = this.frameOffset + editIndex;
      }
    }

    if (absIndex === -1) return;

    for (const [name, vals] of values) {
      const desc = this.buffers.get(name);
      if (!desc) continue;
      const arr = vals instanceof Float32Array ? vals : new Float32Array(vals);
      desc.data.set(arr, absIndex * desc.stride);
    }
    this.markAllDirty();
  }

  getTotalCount(): number {
    return this.frameOffset + this.count;
  }

  /** True when any buffer needs re-upload. */
  get needsUpload(): boolean {
    return this._allDirty || this._dirtyBuffers.size > 0;
  }

  /** Mark every buffer dirty — a full re-upload (structural/color change). */
  markAllDirty(): void {
    this._allDirty = true;
  }

  /**
   * Mark specific buffers dirty for a partial re-upload. Used by the
   * position-only playback fast path so unchanged color/picking buffers are
   * not re-sent to the GPU. A pending full re-upload (`_allDirty`) wins.
   */
  markDirty(...names: string[]): void {
    if (this._allDirty) return;
    for (const name of names) this._dirtyBuffers.add(name);
  }

  /** True when a full re-upload (all buffers) is pending. */
  get isAllDirty(): boolean {
    return this._allDirty;
  }

  /** Whether `name` must be re-uploaded this cycle. */
  isBufferDirty(name: string): boolean {
    return this._allDirty || this._dirtyBuffers.has(name);
  }

  markUploaded(): void {
    this._allDirty = false;
    this._dirtyBuffers.clear();
  }

  /**
   * Force-upload a named buffer to the GPU via thinInstanceSetBuffer.
   * This is the single reliable path — thinInstanceBufferUpdated is unreliable.
   */
  uploadBuffer(name: string): void {
    const desc = this.buffers.get(name);
    if (!desc) return;
    const total = this.frameOffset + this.count;
    const view = desc.data.subarray(0, total * desc.stride);
    this.mesh.thinInstanceSetBuffer(name, view, desc.stride, false);
  }

  private grow(): void {
    const newCapacity = this.capacity * 2;
    for (const [, desc] of this.buffers) {
      const newData = new Float32Array(newCapacity * desc.stride);
      newData.set(desc.data);
      desc.data = newData;
    }
    this.capacity = newCapacity;
  }

  private writePickingColor(_editIndex: number, absIndex: number): void {
    const pickBuf = this.buffers.get("instancePickingColor");
    if (!pickBuf) return;
    const pCol = encodePickingColor(this.mesh.uniqueId, absIndex);
    pickBuf.data.set(pCol, absIndex * 4);
  }

  /**
   * Promote the frame segment [0..frameOffset) into edit space.
   * After promotion, frameOffset becomes 0 and all existing instances are editable.
   *
   * Uses frameIdToIndex/logicalToAllIndices to promote only actual logical IDs,
   * avoiding phantom entries for multi-order bond render instances.
   */
  promoteFrameSegmentToEdits(): void {
    if (this.frameOffset === 0) return;

    const oldFrameOffset = this.frameOffset;
    const oldEditCount = this.count;

    const newIdToIndex = new Map<number, number>();
    const newIndexToId = new Map<number, number>();

    // Promote using logical-ID-to-render-index mapping.
    // For multi-order bonds, frameIdToIndex contains only actual logical IDs
    // (not the extra render instances), preventing phantom edit entries.
    // Use the identity-aware accessors so promotion works whether or not the
    // frame-segment maps were materialized (identity mapping skips them).
    for (const [logicalId, firstRenderIndex] of this.frameLogicalIds()) {
      newIdToIndex.set(logicalId, firstRenderIndex);
    }
    // Map ALL render indices back to their logical IDs (needed for picking)
    for (const [
      logicalId,
      renderIndices,
    ] of this.frameLogicalToRenderEntries()) {
      for (const renderIndex of renderIndices) {
        newIndexToId.set(renderIndex, logicalId);
      }
    }

    for (const [id, editIndex] of this.idToIndex) {
      const promotedIndex = oldFrameOffset + editIndex;
      newIdToIndex.set(id, promotedIndex);
      newIndexToId.set(promotedIndex, id);
    }

    this.frameOffset = 0;
    this.count = oldFrameOffset + oldEditCount;
    this.idToIndex = newIdToIndex;
    this.indexToId = newIndexToId;
  }
}

export class MeshRegistry {
  private atoms: ImpostorState | null = null;
  private bonds: ImpostorState | null = null;

  registerAtomLayer(mesh: Mesh): void {
    this.atoms = new ImpostorState(mesh, ATOM_IMPOSTOR_SPEC.bufferDefs);
  }

  registerBondLayer(mesh: Mesh): void {
    this.bonds = new ImpostorState(mesh, BOND_IMPOSTOR_SPEC.bufferDefs);
  }

  registerBox(_mesh: Mesh): void {
    // storage only
  }

  getAtomState(): ImpostorState | null {
    return this.atoms;
  }
  getBondState(): ImpostorState | null {
    return this.bonds;
  }

  getPoolForMesh(meshId: number): ImpostorState | null {
    if (this.atoms && this.atoms.mesh.uniqueId === meshId) return this.atoms;
    if (this.bonds && this.bonds.mesh.uniqueId === meshId) return this.bonds;
    return null;
  }

  allocateAtom(id: number, data: Map<string, Float32Array | number[]>): number {
    if (!this.atoms) throw new Error("No atom layer registered");
    return this.atoms.append(id, data);
  }

  allocateBond(
    id: number,
    data: Map<string, Float32Array | number[]>,
    subCount = 1,
  ): number {
    if (!this.bonds) throw new Error("No bond layer registered");
    return this.bonds.append(id, data, subCount);
  }

  updateAtom(id: number, data: Map<string, Float32Array | number[]>): void {
    if (this.atoms) this.atoms.updateMulti(id, data);
  }

  updateBond(id: number, data: Map<string, Float32Array | number[]>): void {
    if (this.bonds) this.bonds.updateMulti(id, data);
  }

  freeAtom(id: number): void {
    if (this.atoms) this.atoms.remove(id);
  }

  freeBond(id: number): void {
    if (this.bonds) this.bonds.remove(id);
  }

  clear(): void {
    this.atoms = null;
    this.bonds = null;
  }
}

// ============ SceneIndex ============

/**
 * SceneIndex: unified registry for entity metadata, GPU buffers, and topology.
 */
export class SceneIndex {
  public readonly meshRegistry = new MeshRegistry();
  public readonly metaRegistry = new MetaRegistry();
  public topology: Topology = new Topology();

  private allUnsaved = false;
  public onDirtyChange?: (isDirty: boolean) => void;

  // ============ Query APIs ============

  getType(meshId: number): EntityType | null {
    const atomMesh = this.meshRegistry.getAtomState()?.mesh;
    if (atomMesh && atomMesh.uniqueId === meshId) return "atom";

    const bondMesh = this.meshRegistry.getBondState()?.mesh;
    if (bondMesh && bondMesh.uniqueId === meshId) return "bond";

    return null;
  }

  getMeta(meshId: number, subIndex?: number): EntityMeta | null {
    const atomState = this.meshRegistry.getAtomState();
    if (atomState && atomState.mesh.uniqueId === meshId) {
      if (subIndex === undefined) return null;
      const id =
        subIndex >= atomState.frameOffset
          ? atomState.getIdByIndex(subIndex)
          : subIndex;
      return id === undefined ? null : this.metaRegistry.atoms.getMeta(id);
    }

    const bondState = this.meshRegistry.getBondState();
    if (bondState && bondState.mesh.uniqueId === meshId) {
      if (subIndex === undefined) return null;
      const id =
        subIndex >= bondState.frameOffset
          ? bondState.getIdByIndex(subIndex)
          : subIndex;
      return id === undefined ? null : this.metaRegistry.bonds.getMeta(id);
    }

    return null;
  }

  /**
   * Get the selection key (MeshID:SubIndex) for a logical Atom ID.
   * This performs a reverse lookup.
   */
  getSelectionKeyForAtom(atomId: number): string | null {
    const atomState = this.meshRegistry.getAtomState();
    if (!atomState) return null;

    const editIndex = atomState.idToIndex.get(atomId);
    if (editIndex !== undefined) {
      return makeSelectionKey(
        atomState.mesh.uniqueId,
        atomState.frameOffset + editIndex,
      );
    }
    if (atomId < atomState.frameOffset) {
      return makeSelectionKey(atomState.mesh.uniqueId, atomId);
    }
    return null;
  }

  /**
   * Get the selection key (MeshID:SubIndex) for a logical Bond ID.
   * For multi-order bonds this returns the first render instance.
   */
  getSelectionKeyForBond(bondId: number): string | null {
    const bondState = this.meshRegistry.getBondState();
    if (!bondState) return null;

    const absIndex = bondState.getIndex(bondId);
    if (absIndex === undefined) return null;
    return makeSelectionKey(bondState.mesh.uniqueId, absIndex);
  }

  /**
   * Get ALL selection keys for a logical Bond ID.
   * For multi-order bonds returns one key per render instance (e.g. 2 for double bond).
   */
  getSelectionKeysForBond(bondId: number): string[] {
    const bondState = this.meshRegistry.getBondState();
    if (!bondState) return [];

    const indices = bondState.renderIndicesForLogicalId(bondId);
    if (indices.length === 0) return [];

    return indices.map((idx) => makeSelectionKey(bondState.mesh.uniqueId, idx));
  }

  getNextAtomId(): number {
    return this.metaRegistry.atoms.getMaxId() + 1;
  }

  getNextBondId(): number {
    return this.metaRegistry.bonds.getMaxId() + 1;
  }

  // ============ Registration APIs ============

  /**
   * Register the atom layer for a frame: mesh, GPU buffers, meta source,
   * topology atoms. Clears topology because atoms are the structural
   * anchor — bonds reference atom indices, so any prior bonds become
   * stale when atoms re-register. Bond entries should be added via
   * {@link registerBondFrame} after this.
   *
   * Stores the owning Frame in MetaRegistry (not borrowed Block handles,
   * which go stale on frame.setMeta).
   */
  registerAtomFrame(options: RegisterAtomFrameOptions): void {
    const { frame, mesh, block, buffers } = options;

    this.meshRegistry.registerAtomLayer(mesh);
    this.meshRegistry.getAtomState()?.setFrameData(buffers, block.nrows());
    this.metaRegistry.atoms.setFrame(frame);

    this.topology.clear();
    const atomCount = block.nrows();
    for (let i = 0; i < atomCount; i++) {
      this.topology.addAtom(i);
    }
  }

  /**
   * Register the bond layer: mesh, GPU buffers, meta source, and
   * append bond entries to the existing topology (without clearing
   * it, so atoms registered by {@link registerAtomFrame} are kept).
   */
  registerBondFrame(options: RegisterBondFrameOptions): void {
    const { frame, mesh, block, buffers, instanceCount, instanceMap } = options;

    this.meshRegistry.registerBondLayer(mesh);
    const renderCount = instanceCount ?? block.nrows();
    this.meshRegistry
      .getBondState()
      ?.setFrameData(buffers, renderCount, instanceMap);
    this.metaRegistry.bonds.setFrame(frame);

    const bondCount = block.nrows();
    const iAtoms = block.viewColU32("atomi");
    const jAtoms = block.viewColU32("atomj");
    if (!iAtoms || !jAtoms) return;
    for (let b = 0; b < bondCount; b++) {
      this.topology.addBond(b, iAtoms[b], jAtoms[b]);
    }
  }

  registerBox(options: RegisterBoxOptions): void {
    this.meshRegistry.registerBox(options.mesh);
    this.metaRegistry.box = { type: "box", ...options.meta };
  }

  registerBoxFromFrame(mesh: Mesh, meta: Omit<BoxMeta, "type">): void {
    this.meshRegistry.registerBox(mesh);
    this.metaRegistry.box = { type: "box", ...meta };
  }

  /** Drop the box meta (mesh disposal is the caller's job).
   *  Scoped to box only — does NOT touch atom/bond layers. */
  unregisterBox(): void {
    this.metaRegistry.box = null;
  }

  // ============ Creation / Editing APIs ============

  createAtom(
    meta: Omit<AtomMeta, "type">,
    buffers: Map<string, Float32Array | number[]>,
  ): void {
    this.meshRegistry.allocateAtom(meta.atomId, buffers);
    this.metaRegistry.atoms.setEdit(meta.atomId, { type: "atom", ...meta });
    this.topology.addAtom(meta.atomId);
    this.markAllUnsaved();
  }

  createBond(
    meta: Omit<BondMeta, "type">,
    buffers: Map<string, Float32Array | number[]>,
    subCount = 1,
  ): void {
    this.meshRegistry.allocateBond(meta.bondId, buffers, subCount);
    this.metaRegistry.bonds.setEdit(meta.bondId, { type: "bond", ...meta });
    this.topology.addBond(meta.bondId, meta.atomId1, meta.atomId2);
    this.markAllUnsaved();
  }

  unregisterEditAtom(_baseMeshId: number, atomId: number): void {
    // Ignore baseMeshId (we have global source)
    this.metaRegistry.atoms.removeEdit(atomId);
    this.topology.removeAtom(atomId);
    this.meshRegistry.freeAtom(atomId);
    this.markAllUnsaved();
  }

  unregisterEditBond(_baseMeshId: number, bondId: number): void {
    this.metaRegistry.bonds.removeEdit(bondId);
    this.topology.removeBond(bondId);
    this.meshRegistry.freeBond(bondId);
    this.markAllUnsaved();
  }

  updateAtom(
    _baseMeshId: number,
    atomId: number,
    meta: Partial<Omit<AtomMeta, "type">>,
    bufferUpdates?: Map<string, Float32Array>,
  ): void {
    const existing = this.metaRegistry.atoms.getMeta(atomId);
    if (existing) {
      const updated = { ...existing, ...meta };
      this.metaRegistry.atoms.setEdit(atomId, updated);
    }

    if (bufferUpdates) {
      this.meshRegistry.updateAtom(atomId, bufferUpdates);
    }
    this.markAllUnsaved();
  }

  updateBond(
    _baseMeshId: number,
    bondId: number,
    meta: Partial<Omit<BondMeta, "type">>,
    bufferUpdates?: Map<string, Float32Array>,
  ): void {
    const existing = this.metaRegistry.bonds.getMeta(bondId);
    if (existing) {
      const updated = { ...existing, ...meta };
      this.metaRegistry.bonds.setEdit(bondId, updated);
    }

    if (bufferUpdates) {
      this.meshRegistry.updateBond(bondId, bufferUpdates);
    }
    this.markAllUnsaved();
  }

  unregister(_meshId: number): void {
    this.clear();
  }

  markAllUnsaved() {
    if (this.allUnsaved) return;
    this.allUnsaved = true;
    this.onDirtyChange?.(true);
  }

  get hasUnsavedChanges() {
    return this.allUnsaved;
  }

  markAllSaved() {
    if (!this.allUnsaved) return;
    this.allUnsaved = false;
    this.onDirtyChange?.(false);
  }

  /**
   * Convert currently loaded frame entities into editable pool entries.
   * This is used when entering Edit mode so frame atoms/bonds are editable in place.
   */
  promoteFrameToEditPool(): void {
    const atomState = this.meshRegistry.getAtomState();
    if (atomState && atomState.frameOffset > 0) {
      const atomFrameCount = atomState.frameOffset;
      for (let atomId = 0; atomId < atomFrameCount; atomId++) {
        const meta = this.metaRegistry.atoms.getMeta(atomId);
        if (meta) {
          this.metaRegistry.atoms.setEdit(atomId, { ...meta });
        }
      }
      atomState.promoteFrameSegmentToEdits();
      this.metaRegistry.atoms.setFrame(null);
    }

    const bondState = this.meshRegistry.getBondState();
    if (bondState && bondState.frameOffset > 0) {
      // Iterate logical bond IDs (not render instance indices) to avoid
      // promoting phantom entries for multi-order bond render instances.
      for (const [bondId] of bondState.frameLogicalIds()) {
        const meta = this.metaRegistry.bonds.getMeta(bondId);
        if (meta) {
          this.metaRegistry.bonds.setEdit(bondId, { ...meta });
        }
      }
      bondState.promoteFrameSegmentToEdits();
      this.metaRegistry.bonds.setFrame(null);
    }
  }

  clear(): void {
    this.meshRegistry.clear();
    this.metaRegistry.clear();
    this.topology.clear();
    this.markAllSaved();
  }

  /**
   * Compute the bounding box of the entire scene (atoms).
   */
  getBounds(): {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  } | null {
    const atomState = this.meshRegistry.getAtomState();
    if (!atomState) return null;

    const buffer = atomState.buffers.get("instanceData");
    if (!buffer) return null;

    const data = buffer.data;
    const totalCount = atomState.frameOffset + atomState.count;
    if (totalCount === 0) return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    // instanceData stride is 4: [x, y, z, r]. Expand each atom's box by its
    // radius so an edge atom's whole van-der-Waals sphere is enclosed (the
    // radius `r` used to be read and discarded here).
    const stride = 4;

    for (let i = 0; i < totalCount; i++) {
      const idx = i * stride;
      const x = data[idx];
      const y = data[idx + 1];
      const z = data[idx + 2];
      const r = data[idx + 3];

      if (x - r < minX) minX = x - r;
      if (y - r < minY) minY = y - r;
      if (z - r < minZ) minZ = z - r;

      if (x + r > maxX) maxX = x + r;
      if (y + r > maxY) maxY = y + r;
      if (z + r > maxZ) maxZ = z + r;
    }

    if (minX === Number.POSITIVE_INFINITY) return null;

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
  }

  /**
   * Raw atom centers and radii for oriented-bounding-box / PCA framing.
   *
   * Returns owned copies (not WASM/GPU-memory views) read from the same
   * `instanceData` buffer `getBounds` scans (stride 4: `[x, y, z, r]`):
   * `points` is a flat `[x,y,z, …]` array and `radii` the matching per-atom
   * radii, both length `count`. Returns `null` when there is no atom state.
   */
  getBoundsData(): { points: Float64Array; radii: Float64Array } | null {
    const atomState = this.meshRegistry.getAtomState();
    if (!atomState) return null;

    const buffer = atomState.buffers.get("instanceData");
    if (!buffer) return null;

    const data = buffer.data;
    const totalCount = atomState.frameOffset + atomState.count;
    if (totalCount === 0) return null;

    const stride = 4;
    const points = new Float64Array(totalCount * 3);
    const radii = new Float64Array(totalCount);
    for (let i = 0; i < totalCount; i++) {
      const idx = i * stride;
      points[i * 3] = data[idx];
      points[i * 3 + 1] = data[idx + 1];
      points[i * 3 + 2] = data[idx + 2];
      radii[i] = data[idx + 3];
    }
    return { points, radii };
  }

  // ============ Attribute APIs ============

  /**
   * Set an attribute for an atom.
   * Updates the staging layer (MetaRegistry).
   */
  setAttribute(type: "atom" | "bond", id: number, key: string, value: unknown) {
    if (type === "atom") {
      this.metaRegistry.atoms.setAttribute(id, key, value);
    } else if (type === "bond") {
      this.metaRegistry.bonds.setAttribute(id, key, value);
    }
    this.markAllUnsaved();
  }

  /**
   * Get an attribute value.
   */
  getAttribute(type: "atom" | "bond", id: number, key: string): unknown {
    if (type === "atom") {
      return this.metaRegistry.atoms.getAttribute(id, key);
    }
    if (type === "bond") {
      return this.metaRegistry.bonds.getAttribute(id, key);
    }
    return undefined;
  }
}
