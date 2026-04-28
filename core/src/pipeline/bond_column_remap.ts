import type { Frame } from "@molcrafts/molrs";
import { DType } from "../utils/dtype";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

/**
 * Source columns to translate into molvis's canonical `atomi`/`atomj`.
 * Values are resolved against `atoms.id` at apply time. `offset` is a
 * direct-index fallback used only when the atoms block has no `id`
 * column.
 */
export interface BondColumnMapping {
  atomiSource: string;
  atomjSource: string;
  offset: number;
}

/**
 * Rewrites a bonds block's endpoint columns to canonical `atomi`/
 * `atomj` row indices.
 *
 * Bonds in formats like LAMMPS `dump local` carry persistent atom IDs,
 * not row indices — and atoms.dump's row order can be MPI-shuffled and
 * non-contiguous. So the modifier looks each ID up in the current
 * frame's `atoms.id` column to find its row position. The `offset`
 * field is only used when no `id` column exists.
 *
 * Idempotent: re-running on a block that already has `atomi`/`atomj`
 * is a no-op, so pipeline re-runs (selection toggles, etc.) don't
 * shift values twice.
 */
export class BondColumnRemapModifier extends BaseModifier {
  static readonly NAME = "Bond Column Remap";

  private _mapping: BondColumnMapping;

  constructor(id = "bond-column-remap", mapping?: BondColumnMapping) {
    super(
      id,
      BondColumnRemapModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
    this._mapping = mapping ?? { atomiSource: "", atomjSource: "", offset: 0 };
  }

  get mapping(): BondColumnMapping {
    return this._mapping;
  }
  set mapping(value: BondColumnMapping) {
    this._mapping = value;
  }

  getCacheKey(): string {
    const m = this._mapping;
    return `${super.getCacheKey()}:${m.atomiSource}>atomi:${m.atomjSource}>atomj:${m.offset}`;
  }

  apply(input: Frame, _ctx: PipelineContext): Frame {
    const m = this._mapping;
    if (!m.atomiSource || !m.atomjSource) return input;

    let bonds = input.getBlock("bonds");
    if (bonds === undefined || bonds.nrows() === 0) return input;
    if (
      bonds.dtype("atomi") !== undefined &&
      bonds.dtype("atomj") !== undefined
    ) {
      return input;
    }

    const rawI = readNumericColumnAsU32(bonds, m.atomiSource);
    const rawJ = readNumericColumnAsU32(bonds, m.atomjSource);
    if (rawI === null || rawJ === null) return input;

    const atoms = input.getBlock("atoms");
    const idMap =
      atoms !== undefined && atoms.nrows() > 0 ? buildAtomIdMap(atoms) : null;

    const ai =
      idMap !== null
        ? lookupViaIdMap(rawI, idMap)
        : applyOffset(rawI, m.offset);
    const aj =
      idMap !== null
        ? lookupViaIdMap(rawJ, idMap)
        : applyOffset(rawJ, m.offset);

    // Re-fetch the block between writes — molrs Block handles can be
    // invalidated by mutations that touch the parent frame (see
    // MEMORY note: project_molrs_block_handle_lifecycle).
    bonds.setColU32("atomi", ai);
    bonds = input.getBlock("bonds");
    if (bonds === undefined) return input;
    bonds.setColU32("atomj", aj);

    return input;
  }
}

function lookupViaIdMap(
  raw: Uint32Array,
  idMap: Map<number, number>,
): Uint32Array {
  // Unknown IDs map to row 0 — keeps the bond renderable instead of
  // crashing, and shows up as a visibly wrong endpoint that's easy to
  // spot rather than silently skipping the bond.
  const out = new Uint32Array(raw.length);
  for (let k = 0; k < raw.length; k++) out[k] = idMap.get(raw[k]) ?? 0;
  return out;
}

function applyOffset(raw: Uint32Array, offset: number): Uint32Array {
  if (offset === 0) return raw;
  const out = new Uint32Array(raw.length);
  for (let k = 0; k < raw.length; k++) out[k] = raw[k] + offset;
  return out;
}

function buildAtomIdMap(
  atomsBlock: import("@molcrafts/molrs").Block,
): Map<number, number> | null {
  const dt = atomsBlock.dtype("id");
  if (dt === undefined) return null;

  const map = new Map<number, number>();
  if (dt === DType.U32) {
    const ids = atomsBlock.copyColU32("id");
    if (!ids) return null;
    for (let r = 0; r < ids.length; r++) map.set(ids[r], r);
  } else if (dt === DType.I32) {
    const ids = atomsBlock.copyColI32("id");
    if (!ids) return null;
    for (let r = 0; r < ids.length; r++) map.set(ids[r], r);
  } else if (dt === DType.F64) {
    const ids = atomsBlock.copyColF("id");
    if (!ids) return null;
    for (let r = 0; r < ids.length; r++) map.set(Math.trunc(ids[r]), r);
  } else {
    return null;
  }
  return map;
}

function readNumericColumnAsU32(
  block: import("@molcrafts/molrs").Block,
  column: string,
): Uint32Array | null {
  const dt = block.dtype(column);
  if (dt === undefined) return null;
  if (dt === DType.U32) {
    return block.copyColU32(column) ?? null;
  }
  if (dt === DType.I32) {
    const src = block.copyColI32(column);
    if (src === undefined) return null;
    const out = new Uint32Array(src.length);
    for (let k = 0; k < src.length; k++) out[k] = src[k];
    return out;
  }
  if (dt === DType.F64) {
    // viewColF is a zero-copy view into WASM memory; safe here because
    // we drain it into the new Uint32Array immediately, before any
    // operation that could grow WASM memory and invalidate the view.
    const src = block.viewColF(column);
    if (src === undefined) return null;
    const out = new Uint32Array(src.length);
    for (let k = 0; k < src.length; k++) out[k] = Math.trunc(src[k]);
    return out;
  }
  return null;
}

/**
 * True when the bonds block exists, has rows, and lacks both canonical
 * `atomi`/`atomj` columns. A block with one canonical and one alternate
 * column is treated as already-mapped; the missing one would surface
 * as a render-time error rather than a load-time prompt.
 */
export function bondsNeedColumnMapping(frame: Frame): boolean {
  const bonds = frame.getBlock("bonds");
  if (bonds === undefined || bonds.nrows() === 0) return false;
  return (
    bonds.dtype("atomi") === undefined && bonds.dtype("atomj") === undefined
  );
}

/**
 * Numeric columns of the bonds block — candidates the user can pick as
 * `atomi`/`atomj` in the mapping dialog. Includes f64 because the
 * LAMMPS dump parser stores anything outside its small allowlist as
 * float, even when the values are conceptually integer atom IDs.
 */
export function bondsIntegerColumns(frame: Frame): string[] {
  const bonds = frame.getBlock("bonds");
  if (bonds === undefined) return [];
  const out: string[] = [];
  for (const key of bonds.keys() as string[]) {
    const dt = bonds.dtype(key);
    if (dt === DType.U32 || dt === DType.I32 || dt === DType.F64) {
      out.push(key);
    }
  }
  return out;
}
