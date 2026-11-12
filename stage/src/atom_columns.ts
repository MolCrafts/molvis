/**
 * Atom-column transport — the single column copier in stage.
 *
 * Carries every supported atom column through row remapping for scene commits,
 * optimization and topology/trajectory source alignment. Per-row vectors and
 * scalar columns use the same mapping; no source storage is mutated.
 *
 * `ColumnSource` / `ColumnSink` are declared as structural protocols, not as
 * molrs `Block`, so the unit tests drive them with plain objects and never boot
 * WASM. molrs's `Block` satisfies both as-is.
 */
import type { Column, NumericColumn } from "@molcrafts/molvis-core/molrs";

/**
 * Read side of a column store — molrs `Block`'s read API, narrowed.
 *
 * `dtype` returns molrs's storage dtype; `copy` returns its owned carrier.
 * Numeric widths, boolean/string arrays and per-row shapes are preserved.
 */
export interface ColumnSource {
  /** Column names, in the order they should be copied. */
  keys(): string[];
  /** Rows available to read; a source row index is valid iff `< nRows`. */
  readonly nRows: number;
  /** molrs dtype name for `key`; `key` is one of {@link ColumnSource.keys}. */
  dtype(key: string): string;
  /** Owned copy of the column `key`, in its dtype's array type. */
  copy(key: string): Column;
  /** Per-row scalar by default; trailing dimensions belong to each row. */
  shape?(key: string): number[];
  validity?(key: string): Uint8Array | undefined;
  precision?(key: string): number | undefined;
  target?(key: string): string | undefined;
}

/** Write side of a column store — molrs `Block`'s setter, narrowed. */
export interface ColumnSink {
  set(key: string, data: Column, shape?: number[]): void;
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
 * is rejected explicitly, as are attributes Block.set cannot preserve.
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
      if (
        ![
          "f64",
          "i8",
          "i16",
          "i32",
          "i64",
          "u8",
          "u16",
          "u32",
          "u64",
          "bool",
          "string",
        ].includes(dtype)
      ) {
        throw new Error(
          `Cannot copy column '${key}' with unsupported dtype '${dtype}'`,
        );
      }
      if (
        this.source.validity?.(key) !== undefined ||
        this.source.precision?.(key) !== undefined ||
        this.source.target?.(key) !== undefined
      ) {
        throw new Error(
          `Cannot copy column '${key}': Block.set cannot preserve validity, precision or target`,
        );
      }
      const col = this.source.copy(key) as NumericColumn | boolean[] | string[];
      const shape = this.source.shape?.(key) ?? [this.source.nRows];
      const width = shape
        .slice(1)
        .reduce((size, dimension) => size * dimension, 1);
      const length = rows * width;
      if (dtype === "bool" && length === 0)
        throw new Error(
          `Cannot copy empty bool column '${key}': Block.set infers empty arrays as string`,
        );
      const out = Array.isArray(col)
        ? new Array<string | boolean>(length).fill(
            dtype === "bool" ? false : "",
          )
        : new (col.constructor as new (length: number) => NumericColumn)(
            length,
          );
      for (let row = 0; row < rows; row++) {
        const from = sourceRows[row];
        if (from === UNMAPPED) continue;
        for (let component = 0; component < width; component++) {
          out[row * width + component] = col[from * width + component];
        }
      }
      dst.set(key, out as Column, [rows, ...shape.slice(1)]);
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
      if (
        from === undefined ||
        !Number.isInteger(from) ||
        from < 0 ||
        from >= nrows
      )
        continue;
      resolved[row] = from;
    }
    return resolved;
  }
}
