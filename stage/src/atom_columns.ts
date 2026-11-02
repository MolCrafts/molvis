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
import type { Column } from "@molcrafts/molvis-core/molrs";
import {
  allocLike,
  DType,
  isNumericDtype,
  type NumericArray,
} from "./utils/dtype";

/**
 * Read side of a column store — molrs `Block`'s read API, narrowed.
 *
 * `dtype` returns molrs's dtype string (`"float"` / `"uint"` / `"int"` /
 * `"string"`), and `copy` returns the column in that same dtype as a
 * `Column` — which is why {@link AtomColumnCarrier} always dispatches on
 * `dtype` first and casts each branch to the buffer type it scatters into.
 */
export interface ColumnSource {
  /** Column names, in the order they should be copied. */
  keys(): string[];
  /** Rows available to read; a source row index is valid iff `< nRows`. */
  readonly nRows: number;
  /** molrs dtype string for `key`; only asked about columns `keys()` listed. */
  dtype(key: string): string;
  /** Owned copy of column `key`, in the column's own dtype. molrs `Block.copy`. */
  copy(key: string): Column;
}

/** Write side of a column store — molrs `Block`'s `set`, narrowed. */
export interface ColumnSink {
  set(key: string, data: Column): void;
}

/**
 * Destination row → source row, or `undefined` when the destination row has no
 * source row at all (an atom drawn on canvas, a hydrogen the optimizer added).
 * A row index outside `[0, source.nRows)` counts as `undefined`.
 */
export type SourceRowFor = (row: number) => number | undefined;

/** Destination rows with no source row: numeric columns take 0, strings `""`. */
const UNMAPPED = -1;

/**
 * Gather one numeric column into a fresh buffer: destination row `row` takes
 * `col[sourceRows[row]]`, and an {@link UNMAPPED} row keeps the zero the
 * allocator already put there.
 *
 * `Ctor` decides the destination width, which is what keeps the scattered
 * buffer's dtype exact (f64 / u64 / i32) rather than collapsing the three
 * into one. String columns deliberately do not come through here — their
 * default is `""`, a different kind of empty than a zeroed buffer.
 */
function scatter(
  rows: number,
  sourceRows: Int32Array,
  col: NumericArray,
): NumericArray {
  const out = allocLike(col, rows);
  const dst = out as unknown as Array<number | bigint>;
  const from = col as unknown as ArrayLike<number | bigint>;
  for (let row = 0; row < rows; row++) {
    const src = sourceRows[row];
    if (src !== UNMAPPED) dst[row] = from[src];
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
 * reader runs, so every branch knows the dtype it is about to get back from
 * `copy` and can cast to the buffer type it scatters into. A column whose
 * dtype stage has no reader for (molrs grows dtypes on its own schedule) is
 * skipped silently — the columns around it still copy.
 *
 * **No column is special.** `x` / `y` / `z` / `element` copy like anything else;
 * callers that own those columns overwrite them *after* `copyInto` returns.
 * That order is what lets a caller carry `charge` / `mol_id` / residue fields
 * through while still publishing its own coordinates.
 *
 * @example
 * // Commit: dense row → the scene atom id it came from.
 * new AtomColumnCarrier(sourceAtoms).copyInto(atomBlock, atomCount, rowFor);
 * atomBlock.set("x", x); // caller-owned columns win
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
      const dtype = this.source.dtype(key);
      if (isNumericDtype(dtype)) {
        dst.set(
          key,
          scatter(rows, sourceRows, this.source.copy(key) as NumericArray),
        );
        continue;
      }
      switch (dtype) {
        case DType.String: {
          const col = this.source.copy(key) as string[];
          const out = new Array<string>(rows).fill("");
          for (let row = 0; row < rows; row++) {
            const from = sourceRows[row];
            if (from !== UNMAPPED) out[row] = col[from] ?? "";
          }
          dst.set(key, out);
          break;
        }
        default:
          // Unknown dtype: stage has no reader, so skip the column rather
          // than guess at its storage.
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
    const nrows = this.source.nRows;
    const resolved = new Int32Array(rows).fill(UNMAPPED);
    for (let row = 0; row < rows; row++) {
      const from = sourceRowFor(row);
      if (from === undefined || from < 0 || from >= nrows) continue;
      resolved[row] = from;
    }
    return resolved;
  }
}
