import type { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "./io/atom_coords";
import { BOND_TYPE_SINGLE } from "./utils/bond_order";
import { DType, isFloatDtype } from "./utils/dtype";

// ─────────────────────────────────────────────────────────────────────────────
// Block-handle lifetime
//
// molrs's Block handles are *borrows* into a Frame's column-store and are
// invalidated whenever any code path takes a `with_frame_mut` on the Rust
// side — most notably `frame.setMeta(...)`, which is fired for every label
// column on every frame by `scene.set_frame_labels`. A stored Block field
// becomes stale the moment that happens, and the next `viewCol*` /
// `copyCol*` call throws "Invalid block handle".
//
// The fix is structural: store the Frame (the lifetime owner) and re-derive
// fresh Block handles on every read. AtomSource / BondSource expose
// `frameBlock` / `atomBlock` as getters that do exactly that, so existing
// call sites compile unchanged.
// ─────────────────────────────────────────────────────────────────────────────

// ============ Entity Types ============

export type EntityType = "atom" | "bond" | "box";

// ============ Meta Types ============

export interface AtomMeta {
  type: "atom";
  atomId: number;
  /** Element symbol from the frame's `element` column. `""` when absent. */
  element: string;
  position: { x: number; y: number; z: number };
}

export interface BondMeta {
  type: "bond";
  bondId: number;
  atomId1: number;
  atomId2: number;
  /** molrs `bond_type`: 1 single, 2 double, 3 triple, 4 aromatic. */
  bondType: number;
  /** molrs `bond_number`: Lewis integer; 0 when aromatic has no Kekulé phase. */
  bondNumber: number;
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
}

export interface BoxMeta {
  type: "box";
  dimensions: [number, number, number];
  origin: [number, number, number];
}

export type EntityMeta = AtomMeta | BondMeta | BoxMeta;

// ============ Unified Source Classes ============

export class AtomSource {
  public frame: Frame | null = null;
  public edits = new Map<number, AtomMeta>();

  // Cached element column for the current frame. `copyColStr` materializes the
  // whole element column out of WASM — doing that per getMeta() call (every
  // pick / selection-key lookup) is the dominant per-pick cost. The result is a
  // plain JS string[] copy (NOT a WASM handle), so caching it is safe; it is
  // invalidated whenever the frame changes via setFrame().
  private _elementCache: readonly string[] | null = null;
  private _elementCacheFrame: Frame | null = null;

  /**
   * Fresh Block handle on every access — never cache the result. Block handles
   * are fetched lazily so that any WASM-side version bumps (e.g. the
   * conservative bump that `with_frame_mut` applies when meta/grids are
   * mutated) never leave us holding a stale handle.
   */
  get frameBlock(): Block | null {
    return this.frame?.getBlock("atoms") ?? null;
  }

  setFrame(frame: Frame | null) {
    this.frame = frame;
    this._elementCache = null;
    this._elementCacheFrame = null;
  }

  /**
   * Element column for the current frame, cached. Returns null when the frame
   * has no string `element` column (e.g. LAMMPS `type`-only data).
   */
  private elementColumn(fb: Block): readonly string[] | null {
    if (this._elementCacheFrame === this.frame && this._elementCache) {
      return this._elementCache;
    }
    if (fb.dtype("element") !== DType.String) {
      this._elementCache = null;
      this._elementCacheFrame = this.frame;
      return null;
    }
    const col = fb.copyColStr("element");
    this._elementCache = col;
    this._elementCacheFrame = this.frame;
    return col;
  }

  setEdit(id: number, meta: AtomMeta) {
    this.edits.set(id, meta);
  }

  removeEdit(id: number) {
    this.edits.delete(id);
  }

  /**
   * Set a specific attribute for an atom.
   * Creates an edit entry if one doesn't exist.
   */
  setAttribute(id: number, key: string, value: unknown) {
    let meta = this.edits.get(id);
    if (!meta) {
      const base = this.getFromFrame(id);
      if (!base) return;
      meta = { ...base };
      this.edits.set(id, meta);
    }
    if (key === "x" || key === "y" || key === "z") {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        throw new Error(`Invalid coordinate value for atom ${id}.${key}`);
      }
      meta.position[key] = numericValue;
      return;
    }

    (meta as unknown as Record<string, unknown>)[key] = value;
  }

  /**
   * Get a specific attribute value.
   */
  getAttribute(id: number, key: string): unknown {
    const edit = this.edits.get(id);
    if (edit) {
      if (key === "x") return edit.position.x;
      if (key === "y") return edit.position.y;
      if (key === "z") return edit.position.z;
      if (key in edit) {
        return (edit as unknown as Record<string, unknown>)[key];
      }
    }

    const block = this.frameBlock;
    if (block && id < block.nrows()) {
      if (key === "x" || key === "y" || key === "z") {
        const coords = viewAtomCoords(block);
        const col = coords?.[key];
        if (col) return col[id];
      }
      if (key === "element") {
        const col = this.elementColumn(block);
        if (col) return col[id];
      }
      const col = isFloatDtype(block.dtype(key))
        ? block.viewColF(key)
        : undefined;
      if (col) return col[id];
      const strCol =
        block.dtype(key) === DType.String ? block.copyColStr(key) : undefined;
      if (strCol) return strCol[id];
    }
    return undefined;
  }

  getMeta(id: number): AtomMeta | null {
    const edit = this.edits.get(id);
    if (edit) return edit;

    const block = this.frameBlock;
    if (block && id < block.nrows()) {
      return this.getFromFrame(id, block);
    }
    return null;
  }

  private getFromFrame(index: number, block?: Block): AtomMeta | null {
    const fb = block ?? this.frameBlock;
    if (!fb) return null;

    const coords = viewAtomCoords(fb);
    const x = coords?.x;
    const y = coords?.y;
    const z = coords?.z;

    if (!x || !y || !z) return null;

    // Canonical convention: `element` is String when present, absent otherwise.
    const elements = this.elementColumn(fb);

    return {
      type: "atom",
      atomId: index,
      element: elements?.[index] ?? "",
      position: { x: x[index], y: y[index], z: z[index] },
    };
  }

  getMaxId(): number {
    let max = -1;
    const block = this.frameBlock;
    if (block) {
      max = Math.max(max, block.nrows() - 1);
    }
    for (const id of this.edits.keys()) {
      max = Math.max(max, id);
    }
    return max;
  }

  *getAllIds(): IterableIterator<number> {
    // Yield all frame IDs (0..frameCount-1), whether overridden by edits or not
    const block = this.frameBlock;
    const frameCount = block?.nrows() ?? 0;
    for (let i = 0; i < frameCount; i++) {
      yield i;
    }
    // Yield edit-only IDs that are outside the frame range
    for (const id of this.edits.keys()) {
      if (id >= frameCount) {
        yield id;
      }
    }
  }
}

export class BondSource {
  public frame: Frame | null = null;
  public edits = new Map<number, BondMeta>();

  /**
   * Fresh Block handle on every access — never cache the result. The bonds and
   * atoms blocks are fetched lazily so WASM-side handle-version bumps never
   * leave us holding a stale reference.
   */
  get frameBlock(): Block | null {
    return this.frame?.getBlock("bonds") ?? null;
  }

  /** Current atoms block (needed for bond endpoint positions). Never cache. */
  get atomBlock(): Block | null {
    return this.frame?.getBlock("atoms") ?? null;
  }

  setFrame(frame: Frame | null) {
    this.frame = frame;
  }

  setEdit(id: number, meta: BondMeta) {
    this.edits.set(id, meta);
  }

  removeEdit(id: number) {
    this.edits.delete(id);
  }

  setAttribute(id: number, key: string, value: unknown) {
    let meta = this.edits.get(id);
    if (!meta) {
      const base = this.getFromFrame(id);
      if (!base) return;
      meta = { ...base };
      this.edits.set(id, meta);
    }
    (meta as unknown as Record<string, unknown>)[key] = value;
  }

  getAttribute(id: number, key: string): unknown {
    const edit = this.edits.get(id);
    if (edit && key in edit) {
      return (edit as unknown as Record<string, unknown>)[key];
    }

    const block = this.frameBlock;
    if (block && id < block.nrows()) {
      const col = isFloatDtype(block.dtype(key))
        ? block.viewColF(key)
        : undefined;
      if (col) return col[id];
      const strCol =
        block.dtype(key) === DType.String ? block.copyColStr(key) : undefined;
      if (strCol) return strCol[id];
    }
    return undefined;
  }

  getMeta(id: number): BondMeta | null {
    const edit = this.edits.get(id);
    if (edit) return edit;

    const bondBlock = this.frameBlock;
    const atomBlock = this.atomBlock;
    if (bondBlock && atomBlock && id < bondBlock.nrows()) {
      return this.getFromFrame(id, bondBlock, atomBlock);
    }
    return null;
  }

  private getFromFrame(
    index: number,
    bondBlock?: Block,
    atomBlock?: Block,
  ): BondMeta | null {
    const bb = bondBlock ?? this.frameBlock;
    const ab = atomBlock ?? this.atomBlock;
    if (!bb || !ab) return null;

    const iAtoms = bb.viewColU32("atomi");
    const jAtoms = bb.viewColU32("atomj");
    const typeCol = bb.viewColU32("bond_type");
    const numberCol = bb.viewColU32("bond_number");

    const coords = viewAtomCoords(ab);
    const ax = coords?.x;
    const ay = coords?.y;
    const az = coords?.z;

    if (!iAtoms || !jAtoms || !ax || !ay || !az) return null;

    const i = iAtoms[index];
    const j = jAtoms[index];

    const bondType = typeCol?.[index] ?? BOND_TYPE_SINGLE;
    // Prefer bond_number; if missing, Lewis number matches type for 1–3,
    // and 0 for aromatic / unknown (same as molrs aromatic without Kekulé).
    const bondNumber =
      numberCol?.[index] ??
      (bondType >= BOND_TYPE_SINGLE && bondType <= 3 ? bondType : 0);
    return {
      type: "bond",
      bondId: index,
      atomId1: i,
      atomId2: j,
      bondType,
      bondNumber,
      start: { x: ax[i], y: ay[i], z: az[i] },
      end: { x: ax[j], y: ay[j], z: az[j] },
    };
  }

  getMaxId(): number {
    let max = -1;
    const block = this.frameBlock;
    if (block) {
      max = Math.max(max, block.nrows() - 1);
    }
    for (const id of this.edits.keys()) {
      max = Math.max(max, id);
    }
    return max;
  }

  *getAllIds(): IterableIterator<number> {
    const block = this.frameBlock;
    const frameCount = block?.nrows() ?? 0;
    for (let i = 0; i < frameCount; i++) {
      yield i;
    }
    for (const id of this.edits.keys()) {
      if (id >= frameCount) {
        yield id;
      }
    }
  }
}

// ============ Meta Registry ============

export class MetaRegistry {
  public atoms = new AtomSource();
  public bonds = new BondSource();
  public box: BoxMeta | null = null; // Simple box storage

  clear() {
    this.atoms = new AtomSource();
    this.bonds = new BondSource();
    this.box = null;
  }
}
