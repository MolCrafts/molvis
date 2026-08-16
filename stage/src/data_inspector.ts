/**
 * Data extraction utilities for the Data Inspector panel.
 * Pure functions that convert Frame Block data into table-friendly structures.
 */

import type { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { resolveBondOrders } from "./utils/bond_order";
import { type ColumnDType, DType, isFloatDtype } from "./utils/dtype";

export interface ColumnDescriptor {
  name: string;
  dtype: string;
}

export interface AtomRow {
  index: number;
  values: Map<string, string>;
}

export interface BondRow {
  index: number;
  i: number;
  j: number;
  order: number;
}

/**
 * Discover all columns in an atoms Block.
 * Returns column descriptors sorted: element first, then x/y/z, then rest alphabetically.
 */
export function discoverAtomColumns(block: Block): ColumnDescriptor[] {
  const keys = block.keys();
  const columns: ColumnDescriptor[] = [];
  for (const key of keys) {
    if (key.startsWith("__")) continue; // skip internal columns
    const dtype = block.dtype(key);
    if (dtype) columns.push({ name: key, dtype });
  }

  // Sort: element first, then x/y/z, then alphabetical
  const priority: Record<string, number> = {
    element: 0,
    x: 1,
    y: 2,
    z: 3,
  };
  columns.sort((a, b) => {
    const pa = priority[a.name] ?? 100;
    const pb = priority[b.name] ?? 100;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  return columns;
}

type PrefetchedColumn = {
  dtype: ColumnDType;
  f64?: Float64Array;
  u32?: Uint32Array;
  i32?: Int32Array;
  string?: string[];
};

/** Grab typed views (numeric) / copies (string) for every column once. */
function prefetchColumns(
  block: Block,
  columns: ColumnDescriptor[],
): Map<string, PrefetchedColumn> {
  const columnData = new Map<string, PrefetchedColumn>();
  for (const col of columns) {
    const dt = col.dtype;
    if (dt === DType.String) {
      columnData.set(col.name, {
        dtype: DType.String,
        string: block.copyColStr(col.name) as string[],
      });
    } else if (isFloatDtype(dt)) {
      columnData.set(col.name, {
        dtype: dt,
        f64: block.viewColF(col.name),
      });
    } else if (dt === DType.U32) {
      columnData.set(col.name, {
        dtype: DType.U32,
        u32: block.viewColU32(col.name),
      });
    } else if (dt === DType.I32) {
      columnData.set(col.name, {
        dtype: DType.I32,
        i32: block.viewColI32(col.name),
      });
    }
  }
  return columnData;
}

function materializeRow(
  index: number,
  columns: ColumnDescriptor[],
  columnData: Map<string, PrefetchedColumn>,
): AtomRow {
  const values = new Map<string, string>();
  for (const col of columns) {
    const data = columnData.get(col.name);
    if (!data) {
      values.set(col.name, "—");
      continue;
    }
    if (isFloatDtype(data.dtype) && data.f64) {
      values.set(col.name, formatNumber(data.f64[index]));
    } else if (data.dtype === DType.U32 && data.u32) {
      values.set(col.name, String(data.u32[index]));
    } else if (data.dtype === DType.I32 && data.i32) {
      values.set(col.name, String(data.i32[index]));
    } else if (data.dtype === DType.String && data.string) {
      values.set(col.name, data.string[index] ?? "—");
    }
  }
  return { index, values };
}

/**
 * Extract atom rows from a Frame's atoms Block.
 * Returns rows with all column values as formatted strings.
 */
export function extractAtomRows(
  block: Block,
  columns: ColumnDescriptor[],
  startIndex = 0,
  count?: number,
): AtomRow[] {
  const nrows = block.nrows();
  const end = count ? Math.min(startIndex + count, nrows) : nrows;
  const columnData = prefetchColumns(block, columns);
  const rows: AtomRow[] = [];
  for (let i = startIndex; i < end; i++) {
    rows.push(materializeRow(i, columns, columnData));
  }
  return rows;
}

/**
 * Materialize exactly the given row indices (a virtualized window, possibly
 * non-contiguous after sorting/filtering). O(window), never O(table) — the
 * whole-table `extractAtomRows` froze the UI at ~20k atoms.
 */
export function extractAtomRowsAt(
  block: Block,
  columns: ColumnDescriptor[],
  indices: readonly number[],
): AtomRow[] {
  const nrows = block.nrows();
  const columnData = prefetchColumns(block, columns);
  const rows: AtomRow[] = [];
  for (const i of indices) {
    if (i < 0 || i >= nrows) continue;
    rows.push(materializeRow(i, columns, columnData));
  }
  return rows;
}

/** Whole-column sort keys: numeric where possible, strings otherwise. */
export type ColumnSortKeys =
  | { kind: "numeric"; values: Float64Array }
  | { kind: "string"; values: string[] };

/**
 * Copy one column as raw sort keys (numbers stay numbers — no per-cell
 * string formatting). Returns owned arrays so the caller may cache them
 * across renders without holding a WASM view.
 */
export function extractAtomSortKeys(
  block: Block,
  column: ColumnDescriptor,
): ColumnSortKeys | null {
  switch (column.dtype) {
    case DType.F64:
    case DType.F32: {
      const view = block.viewColF(column.name);
      return view ? { kind: "numeric", values: Float64Array.from(view) } : null;
    }
    case DType.U32: {
      const view = block.viewColU32(column.name);
      return view ? { kind: "numeric", values: Float64Array.from(view) } : null;
    }
    case DType.I32: {
      const view = block.viewColI32(column.name);
      return view ? { kind: "numeric", values: Float64Array.from(view) } : null;
    }
    case DType.String: {
      const values = block.copyColStr(column.name) as string[] | undefined;
      return values ? { kind: "string", values } : null;
    }
    default:
      return null;
  }
}

/** Columnar bond table — typed arrays, no per-row objects. */
export interface BondColumns {
  count: number;
  i: Uint32Array;
  j: Uint32Array;
  /** null when the frame carries no order information (order = 1). */
  order: Uint32Array | null;
}

/**
 * Copy the bond table as columns. Owned arrays (safe to cache); reading a
 * cell is `cols.i[row]` — no 20k-row object allocation.
 */
export function extractBondColumns(frame: Frame): BondColumns | null {
  const bonds = frame.getBlock("bonds");
  if (!bonds) return null;
  if (
    bonds.dtype("atomi") !== DType.U32 ||
    bonds.dtype("atomj") !== DType.U32
  ) {
    return null;
  }
  const iCol = bonds.viewColU32("atomi");
  const jCol = bonds.viewColU32("atomj");
  if (!iCol || !jCol) return null;
  const orderCol = resolveBondOrders(bonds);
  return {
    count: bonds.nrows(),
    i: Uint32Array.from(iCol),
    j: Uint32Array.from(jCol),
    order: orderCol ? Uint32Array.from(orderCol) : null,
  };
}

/**
 * Extract bond rows from a Frame's bonds Block.
 */
export function extractBondRows(frame: Frame): BondRow[] {
  const bonds = frame.getBlock("bonds");
  if (!bonds) return [];

  if (
    bonds.dtype("atomi") !== DType.U32 ||
    bonds.dtype("atomj") !== DType.U32
  ) {
    return [];
  }
  const iCol = bonds.viewColU32("atomi");
  const jCol = bonds.viewColU32("atomj");

  const orderCol = resolveBondOrders(bonds);
  const rows: BondRow[] = [];

  for (let b = 0; b < bonds.nrows(); b++) {
    rows.push({
      index: b,
      i: iCol[b],
      j: jCol[b],
      order: orderCol ? orderCol[b] : 1,
    });
  }

  return rows;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  // Use fixed 3 for typical coordinate precision
  return Math.abs(value) < 0.001 && value !== 0
    ? value.toExponential(2)
    : value.toFixed(3);
}
