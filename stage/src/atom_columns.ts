/**
 * Atom-column transport — the single column copier in stage.
 *
 * Two paths need "carry every atom column of a source block onto a new block
 * whose rows are a re-indexing of the source rows": the commit path
 * ({@link materializeFrameFromScene}, where canvas edits made the rows sparse or
 * longer) and the optimize round trip (`optimize/structure.ts`, where the worker
 * may have appended hydrogens). Both used to drop or privately re-implement it;
 * this module is what they share.
 *
 * `ColumnSource` / `ColumnSink` are declared as structural protocols, not as
 * molrs `Block`, so the unit tests drive them with plain objects and never boot
 * WASM. molrs's `Block` satisfies both as-is.
 */
import { DType } from "./utils/dtype";

/**
 * Read side of a column store — molrs `Block`'s read API, narrowed.
 *
 * `dtype` returns molrs's dtype string (`"f64"` / `"f32"` / `"u32"` / `"i32"` /
 * `"string"`), and the `copyCol*` readers are only valid for the matching
 * dtype — molrs throws when a reader is used against the wrong column, which is
 * why {@link AtomColumnCarrier} always dispatches on `dtype` first.
 */
export interface ColumnSource {
  /** Column names, in the order they should be copied. */
  keys(): string[];
  /** Rows available to read; a source row index is valid iff `< nrows()`. */
  nrows(): number;
  /** molrs dtype string for `key`, or undefined when the column is absent. */
  dtype(key: string): string | undefined;
  /** Owned copy of a float column (`"f64"` or `"f32"`). */
  copyColF(key: string): Float64Array | Float32Array | undefined;
  /** Owned copy of a `"string"` column. */
  copyColStr(key: string): string[] | undefined;
  /** Owned copy of a `"u32"` column. */
  copyColU32(key: string): Uint32Array | undefined;
  /** Owned copy of an `"i32"` column. */
  copyColI32(key: string): Int32Array | undefined;
}

/** Write side of a column store — molrs `Block`'s setters, narrowed. */
export interface ColumnSink {
  setColF(key: string, value: Float64Array): void;
  setColStr(key: string, value: string[]): void;
  setColU32(key: string, value: Uint32Array): void;
  setColI32(key: string, value: Int32Array): void;
}

/**
 * Destination row → source row, or `undefined` when the destination row has no
 * source row at all (an atom drawn on canvas, a hydrogen the optimizer added).
 * A row index outside `[0, source.nrows())` counts as `undefined`.
 */
export type SourceRowFor = (row: number) => number | undefined;

/** Destination rows with no source row: numeric columns take 0, strings `""`. */
const UNMAPPED = -1;

/**
 * Gather one numeric column into a fresh buffer: destination row `row` takes
 * `col[sourceRows[row]]`, and an {@link UNMAPPED} row keeps the zero the
 * allocator already put there.
 *
 * `Ctor` decides the destination width, which is what keeps each
 * {@link ColumnSink} setter's buffer type exact (f64 / u32 / i32) rather than
 * collapsing the three into one. String columns deliberately do not come
 * through here — their default is `""`, a different kind of empty than a
 * zeroed buffer.
 */
function scatter<T extends Float64Array | Uint32Array | Int32Array>(
  rows: number,
  sourceRows: Int32Array,
  col: ArrayLike<number>,
  Ctor: new (length: number) => T,
): T {
  const out = new Ctor(rows);
  for (let row = 0; row < rows; row++) {
    const from = sourceRows[row];
    if (from !== UNMAPPED) out[row] = col[from];
  }
  return out;
}

/**
 * Copies every column of one block onto another under a caller-supplied row
 * mapping.
 *
 * **Reads only.** The source is never written to and never freed — a molrs
 * `Block` handed in here is a *borrow* out of its `Frame`, and freeing it would
 * corrupt the frame's shared column data (`.claude/notes/molrs-handles.md`).
 * Ownership of the source stays with whoever opened the frame.
 *
 * **dtype dispatch.** Each column is routed by `source.dtype(key)` *before* any
 * reader runs, because molrs's readers throw on a dtype mismatch. A column
 * whose dtype stage has no reader for (molrs grows dtypes on its own schedule)
 * is skipped silently — the columns around it still copy.
 *
 * **No column is special.** `x` / `y` / `z` / `element` copy like anything else;
 * callers that own those columns overwrite them *after* `copyInto` returns.
 * That order is what lets a caller carry `charge` / `mol_id` / residue fields
 * through while still publishing its own coordinates.
 *
 * @example
 * // Commit: dense row → the scene atom id it came from.
 * new AtomColumnCarrier(sourceAtoms).copyInto(atomBlock, atomCount, rowFor);
 * atomBlock.setColF("x", x); // caller-owned columns win
 */
export class AtomColumnCarrier {
  constructor(private readonly source: ColumnSource) {}

  /**
   * Write `rows` rows of every source column into `dst`.
   *
   * `rows` is the destination's height and is independent of the source's:
   * fewer rows (atoms deleted on canvas), more rows (hydrogens added), or the
   * same count in a different order all go through the same `sourceRowFor`.
   * Destination rows that `sourceRowFor` leaves unmapped read 0 (numeric) or
   * `""` (string) — never a neighbouring row's value.
   */
  copyInto(dst: ColumnSink, rows: number, sourceRowFor: SourceRowFor): void {
    if (rows <= 0) return;
    const sourceRows = this.resolveRows(rows, sourceRowFor);

    for (const key of this.source.keys()) {
      switch (this.source.dtype(key)) {
        case DType.F64:
        case DType.F32: {
          // Always widened to f64: `ColumnSink.setColF` takes the wide buffer
          // and molrs narrows it back if its own build is f32.
          const col = this.source.copyColF(key);
          if (!col) break;
          dst.setColF(key, scatter(rows, sourceRows, col, Float64Array));
          break;
        }
        case DType.U32: {
          const col = this.source.copyColU32(key);
          if (!col) break;
          dst.setColU32(key, scatter(rows, sourceRows, col, Uint32Array));
          break;
        }
        case DType.I32: {
          const col = this.source.copyColI32(key);
          if (!col) break;
          dst.setColI32(key, scatter(rows, sourceRows, col, Int32Array));
          break;
        }
        case DType.String: {
          const col = this.source.copyColStr(key);
          if (!col) break;
          const out = new Array<string>(rows).fill("");
          for (let row = 0; row < rows; row++) {
            const from = sourceRows[row];
            if (from !== UNMAPPED) out[row] = col[from] ?? "";
          }
          dst.setColStr(key, out);
          break;
        }
        default:
          // Unknown (or absent) dtype: stage has no reader, so skip the column
          // rather than guess at its storage.
          break;
      }
    }
  }

  /**
   * Resolve the mapping once for all columns, so `sourceRowFor` is asked about
   * each destination row exactly once and every column agrees on the answer.
   * Out-of-range answers collapse into {@link UNMAPPED} here, which is what
   * makes "id past the source's last row" mean "new atom" at the call sites.
   */
  private resolveRows(rows: number, sourceRowFor: SourceRowFor): Int32Array {
    const nrows = this.source.nrows();
    const resolved = new Int32Array(rows).fill(UNMAPPED);
    for (let row = 0; row < rows; row++) {
      const from = sourceRowFor(row);
      if (from === undefined || from < 0 || from >= nrows) continue;
      resolved[row] = from;
    }
    return resolved;
  }
}
