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
