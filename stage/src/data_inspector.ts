/**
 * Data extraction utilities for the Data Inspector panel.
 * Pure functions that convert Frame Block data into table-friendly structures.
 */

import { toRowIndex } from "@molcrafts/molvis-core";
import { DisplayNumber } from "@molcrafts/molvis-core/display-number";
import type { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { displayBondOrder, resolveBondOrders } from "./utils/bond_order";
import {
  asFloat64,
  type ColumnDType,
  DType,
  isDomainUintDtype,
  isFloatColumn,
  isNumericDtype,
  type NumericArray,
} from "./utils/dtype";

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
  dtype: ColumnDType | string;
  /** molrs validity mask (0 = null cell); undefined when no cell is null. */
  valid?: Uint8Array;
  numeric?: NumericArray;
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
        valid: block.validity(col.name),
        string: block.copy(col.name) as string[],
      });
    } else if (isNumericDtype(dt)) {
      columnData.set(col.name, {
        dtype: dt,
        valid: block.validity(col.name),
        numeric: block.view(col.name) as NumericArray,
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
    // A null cell holds no value; its filled 0 / "" is not one.
    if (!data || data.valid?.[index] === 0) {
      values.set(col.name, "—");
      continue;
    }
    if (data.numeric) {
      const value = data.numeric[index];
      values.set(
        col.name,
        isFloatColumn(data.dtype) ? formatNumber(Number(value)) : String(value),
      );
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
  const nrows = block.nRows;
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
  const nrows = block.nRows;
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
  if (isNumericDtype(column.dtype)) {
    const view = block.view(column.name) as NumericArray;
    return { kind: "numeric", values: Float64Array.from(asFloat64(view)) };
  }
  switch (column.dtype) {
    case DType.String: {
      const values = block.copy(column.name) as string[] | undefined;
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
  if (!frame.has("bonds")) return null;
  const bonds = frame.get("bonds");
  if (
    !bonds.has("atomi") ||
    !bonds.has("atomj") ||
    !isDomainUintDtype(bonds.dtype("atomi")) ||
    !isDomainUintDtype(bonds.dtype("atomj"))
  ) {
    return null;
  }
  const iCol = bonds.view("atomi") as BigUint64Array;
  const jCol = bonds.view("atomj") as BigUint64Array;
  const orderCol = resolveBondOrders(bonds);
  return {
    count: bonds.nRows,
    i: Uint32Array.from(iCol, toRowIndex),
    j: Uint32Array.from(jCol, toRowIndex),
    order: orderCol ? Uint32Array.from(orderCol) : null,
  };
}

/**
 * Extract bond rows from a Frame's bonds Block.
 */
export interface TopologyEdge {
  id: number;
  source: number;
  target: number;
}

/**
 * Bond table for an unsaved scene. Endpoints come from Topology.
 * `orderOf` supplies chemical order for a bond id; it is not connectivity.
 */
export function extractTopologyBondColumns(
  edges: Iterable<TopologyEdge>,
  orderOf: (bondId: number) => { bondType: number; bondNumber: number } | null,
): BondColumns {
  const i: number[] = [];
  const j: number[] = [];
  const order: number[] = [];
  for (const edge of edges) {
    i.push(edge.source);
    j.push(edge.target);
    const cols = orderOf(edge.id);
    order.push(cols ? displayBondOrder(cols.bondType, cols.bondNumber) : 1);
  }
  return {
    count: i.length,
    i: Uint32Array.from(i),
    j: Uint32Array.from(j),
    order: i.length > 0 ? Uint32Array.from(order) : null,
  };
}

export function extractBondRows(frame: Frame): BondRow[] {
  if (!frame.has("bonds")) return [];
  const bonds = frame.get("bonds");

  if (
    !bonds.has("atomi") ||
    !bonds.has("atomj") ||
    !isDomainUintDtype(bonds.dtype("atomi")) ||
    !isDomainUintDtype(bonds.dtype("atomj"))
  ) {
    return [];
  }
  const iCol = bonds.view("atomi") as BigUint64Array;
  const jCol = bonds.view("atomj") as BigUint64Array;

  const orderCol = resolveBondOrders(bonds);
  const rows: BondRow[] = [];

  for (let b = 0; b < bonds.nRows; b++) {
    rows.push({
      index: b,
      i: toRowIndex(iCol[b]),
      j: toRowIndex(jCol[b]),
      order: orderCol ? orderCol[b] : 1,
    });
  }

  return rows;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new DisplayNumber(value).science();
}
