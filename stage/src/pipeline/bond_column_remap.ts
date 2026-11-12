import { toDomainUint, toRowIndex } from "@molcrafts/molvis-core";
import { Frame } from "@molcrafts/molvis-core/molrs";
import { matchBondEndpointColumns } from "../io/formats";
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
 * Copy-on-write: the rewritten columns land on a fresh Frame (every block
 * deep-copied via `set`), never on the input — the input may be the
 * DataSource's cached provider frame. A block that already carries
 * `atomi`/`atomj` passes through untouched, so re-runs never shift twice.
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

    let bonds = input.has("bonds") ? input.get("bonds") : undefined;
    if (bonds === undefined || bonds.nRows === 0) return input;
    if (bonds.has("atomi") && bonds.has("atomj")) {
      return input;
    }

    const rawI = readNumericColumnAsU32(bonds, m.atomiSource);
    const rawJ = readNumericColumnAsU32(bonds, m.atomjSource);
    if (rawI === null || rawJ === null) return input;

    const atoms = input.has("atoms") ? input.get("atoms") : undefined;
    const idMap =
      atoms !== undefined && atoms.nRows > 0 ? buildAtomIdMap(atoms) : null;

    const ai =
      idMap !== null
        ? lookupViaIdMap(rawI, idMap)
        : applyOffset(rawI, m.offset);
    const aj =
      idMap !== null
        ? lookupViaIdMap(rawJ, idMap)
        : applyOffset(rawJ, m.offset);

    const result = new Frame();
    for (const name of input.keys()) {
      const block = input.has(name) ? input.get(name) : undefined;
      if (block) result.set(name, block);
    }
    if (input.box) result.box = input.box;

    // Re-fetch the block between writes — molrs Block handles can be
    // invalidated by mutations that touch the parent frame (see
    // `.claude/notes/molrs-handles.md`).
    bonds = result.has("bonds") ? result.get("bonds") : undefined;
    if (bonds === undefined) return input;
    bonds.set("atomi", ai);
    bonds = result.has("bonds") ? result.get("bonds") : undefined;
    if (bonds === undefined) return input;
    bonds.set("atomj", aj);

    return result;
  }
}

function lookupViaIdMap(
  raw: BigUint64Array,
  idMap: Map<number, number>,
): BigUint64Array {
  const out = new BigUint64Array(raw.length);
  let unknown = 0;
  let sample: number | undefined;
  for (let k = 0; k < raw.length; k++) {
    const id = toRowIndex(raw[k]);
    const row = idMap.get(id);
    if (row === undefined) {
      unknown += 1;
      if (sample === undefined) sample = id;
      continue;
    }
    out[k] = BigInt(row);
  }
  if (unknown > 0) {
    throw new Error(
      `Bond Column Remap: ${unknown} bond endpoint(s) are not in this structure's atom id column (e.g. id ${sample}). Check the column mapping.`,
    );
  }
  return out;
}

function applyOffset(raw: BigUint64Array, offset: number): BigUint64Array {
  if (offset === 0) return raw;
  const out = new BigUint64Array(raw.length);
  const delta = BigInt(offset);
  for (let k = 0; k < raw.length; k++) out[k] = raw[k] + delta;
  return out;
}

function buildAtomIdMap(
  atomsBlock: import("@molcrafts/molvis-core/molrs").Block,
): Map<number, number> | null {
  // molrs pins the canonical "id" column to domain uint / u64
  // (Block::insert refuses any other dtype under that key).
  if (!atomsBlock.has("id") || atomsBlock.dtype("id") !== DType.Uint)
    return null;
  const ids = atomsBlock.copy("id") as BigUint64Array;
  if (!ids) return null;
  const map = new Map<number, number>();
  for (let r = 0; r < ids.length; r++) map.set(toRowIndex(ids[r]), r);
  return map;
}

function readNumericColumnAsU32(
  block: import("@molcrafts/molvis-core/molrs").Block,
  column: string,
): BigUint64Array | null {
  if (!block.has(column)) return null;
  const dt = block.dtype(column);
  if (dt === DType.Uint) return block.copy(column) as BigUint64Array;
  if (dt === DType.Int) return toDomainUint(block.copy(column) as Int32Array);
  if (dt === DType.Float) {
    // A zero-copy view into WASM memory; safe here because it is drained into
    // the domain-uint buffer immediately, before any operation that could
    // grow WASM memory and invalidate the view.
    const src = block.view(column) as Float64Array;
    const truncated = new Int32Array(src.length);
    for (let k = 0; k < src.length; k++) truncated[k] = Math.trunc(src[k]);
    return toDomainUint(truncated);
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
  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  if (bonds === undefined || bonds.nRows === 0) return false;
  return !bonds.has("atomi") && !bonds.has("atomj");
}

/**
 * Numeric columns of the bonds block — candidates the user can pick as
 * `atomi`/`atomj` in the mapping dialog. Includes f64 because the
 * LAMMPS dump parser stores anything outside its small allowlist as
 * float, even when the values are conceptually integer atom IDs.
 */
export function bondsIntegerColumns(frame: Frame): string[] {
  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  if (bonds === undefined) return [];
  const out: string[] = [];
  for (const key of bonds.keys()) {
    const dt = bonds.dtype(key);
    if (dt === DType.Uint || dt === DType.Int || dt === DType.Float) {
      out.push(key);
    }
  }
  return out;
}

/**
 * The unambiguous column mapping for `frame`'s bonds block, or `null` when
 * the endpoints have to be picked by hand.
 *
 * Inference is limited to the spellings OVITO's LAMMPS-dump-local reader
 * recognises ({@link matchBondEndpointColumns}). A `dump local` file's column
 * names are whatever the dump command was given — `c_bond[1] c_bond[2]` by
 * default — so most files land here with nothing recognisable and must be
 * mapped by the user; guessing would draw wrong topology in silence.
 *
 * Callers consult this before prompting, so a file whose columns were named
 * with `dump_modify … colname` needs no dialog — which is also what makes it
 * work on a host with no dialog to show.
 */
export function inferBondColumnMapping(frame: Frame): BondColumnMapping | null {
  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  if (bonds === undefined || bonds.nRows === 0) return null;
  const matched = matchBondEndpointColumns(bonds.keys());
  if (matched === undefined) return null;
  const [atomiSource, atomjSource] = matched;
  // Values are persistent LAMMPS atom IDs; the modifier resolves them
  // against `atoms.id`, so the direct-index offset is never used.
  return { atomiSource, atomjSource, offset: 0 };
}
