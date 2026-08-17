/** Fine pointer density (scientific table). */
export const INSPECTOR_ROW_HEIGHT_FINE = 20;
/** Coarse pointer minimum hit target (matches App resizeTargetMinimumSize.coarse). */
export const INSPECTOR_ROW_HEIGHT_COARSE = 44;

/**
 * Single row-height token for both CSS and the virtualizer.
 * Never hard-code a second height beside this helper.
 */
export function resolveInspectorRowHeight(
  isCoarsePointer: boolean = prefersCoarsePointer(),
): number {
  return isCoarsePointer
    ? INSPECTOR_ROW_HEIGHT_COARSE
    : INSPECTOR_ROW_HEIGHT_FINE;
}

export function prefersCoarsePointer(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;
  try {
    return globalThis.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/**
 * Map a pointer Y (relative to the scrollport content) to a row index.
 * `contentY = scrollTop + (clientY - containerTop)`.
 */
export function rowIndexFromContentY(
  contentY: number,
  rowHeight: number,
  rowCount: number,
): number {
  if (rowHeight <= 0 || rowCount <= 0) return -1;
  const index = Math.floor(contentY / rowHeight);
  if (index < 0 || index >= rowCount) return -1;
  return index;
}

// ── Column sorting ────────────────────────────────────────────────

export type SortDirection = 1 | -1;

/** Active sort: which column key and which direction. */
export interface SortSpec {
  key: string;
  dir: SortDirection;
}

/**
 * Header-click cycle for one column: none → ascending → descending → none.
 * Clicking a different column always starts ascending.
 */
export function toggleSort(
  prev: SortSpec | null,
  key: string,
): SortSpec | null {
  if (prev?.key !== key) return { key, dir: 1 };
  if (prev.dir === 1) return { key, dir: -1 };
  return null;
}

/**
 * Numeric-first cell comparator for table sorting: values that parse as
 * finite numbers order numerically (so "10" > "9" and "-26.2" < "-19.5"),
 * everything else falls back to locale string comparison. Missing cells
 * always sort last regardless of direction.
 */
export function compareCellValues(
  a: string | undefined,
  b: string | undefined,
  dir: SortDirection,
): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const na = Number.parseFloat(a);
  const nb = Number.parseFloat(b);
  const bothNumeric = Number.isFinite(na) && Number.isFinite(nb);
  const cmp = bothNumeric ? na - nb : a.localeCompare(b);
  return dir * (cmp < 0 ? -1 : cmp > 0 ? 1 : 0);
}

// ── Virtual-data index helpers (lazy tables) ──────────────────────
//
// The inspector never materializes all rows: it works on index arrays and
// extracts only the visible window. These helpers stay O(N) over plain
// numbers — no per-row objects — so 20k+ atoms stay interactive.

/** Row indices `0..count` that pass `keep`, as a compact typed array. */
export function filterIndices(
  count: number,
  keep: (index: number) => boolean,
): Uint32Array {
  const out = new Uint32Array(count);
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (keep(i)) out[n++] = i;
  }
  return out.subarray(0, n);
}

/**
 * Stable argsort: returns a NEW index array ordering `base` (or the identity
 * `0..count` when base is null) by `compare` over row indices. Ties keep the
 * base order via the index fallback the caller bakes into `compare`.
 */
export function sortIndices(
  base: Uint32Array | null,
  count: number,
  compare: (a: number, b: number) => number,
): Uint32Array {
  const out = base ? base.slice() : new Uint32Array(count);
  if (!base) {
    for (let i = 0; i < count; i++) out[i] = i;
  }
  out.sort(compare);
  return out;
}
