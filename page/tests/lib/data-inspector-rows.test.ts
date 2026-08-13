import { describe, expect, it } from "@rstest/core";
import {
  compareCellValues,
  filterIndices,
  INSPECTOR_ROW_HEIGHT_COARSE,
  INSPECTOR_ROW_HEIGHT_FINE,
  resolveInspectorRowHeight,
  rowIndexFromContentY,
  sortIndices,
  toggleSort,
} from "@/lib/data-inspector-rows";

describe("resolveInspectorRowHeight", () => {
  it("uses 20px for fine pointer and 44px for coarse", () => {
    expect(resolveInspectorRowHeight(false)).toBe(INSPECTOR_ROW_HEIGHT_FINE);
    expect(resolveInspectorRowHeight(true)).toBe(INSPECTOR_ROW_HEIGHT_COARSE);
    expect(INSPECTOR_ROW_HEIGHT_COARSE).toBeGreaterThanOrEqual(44);
  });
});

describe("rowIndexFromContentY", () => {
  it("maps scroll + pointer into the correct virtual row", () => {
    const h = 20;
    // Mid-row 5 after scroll.
    expect(rowIndexFromContentY(5 * h + 10, h, 100)).toBe(5);
    // Coarse 44px rows.
    expect(rowIndexFromContentY(2 * 44 + 1, 44, 10)).toBe(2);
  });

  it("returns -1 out of range", () => {
    expect(rowIndexFromContentY(-1, 20, 5)).toBe(-1);
    expect(rowIndexFromContentY(100, 20, 3)).toBe(-1);
    expect(rowIndexFromContentY(0, 0, 3)).toBe(-1);
  });
});

describe("toggleSort", () => {
  it("cycles none → asc → desc → none on the same column", () => {
    const asc = toggleSort(null, "x");
    expect(asc).toEqual({ key: "x", dir: 1 });
    const desc = toggleSort(asc, "x");
    expect(desc).toEqual({ key: "x", dir: -1 });
    expect(toggleSort(desc, "x")).toBeNull();
  });

  it("switching columns always restarts ascending", () => {
    const desc = { key: "x", dir: -1 as const };
    expect(toggleSort(desc, "y")).toEqual({ key: "y", dir: 1 });
  });
});

describe("compareCellValues", () => {
  it("orders numeric strings numerically, not lexically", () => {
    expect(compareCellValues("9", "10", 1)).toBeLessThan(0);
    expect(compareCellValues("-26.2", "-19.5", 1)).toBeLessThan(0);
    expect(compareCellValues("2.5", "2.5", 1)).toBe(0);
  });

  it("falls back to locale comparison for non-numeric cells", () => {
    expect(compareCellValues("ALA", "GLN", 1)).toBeLessThan(0);
    expect(compareCellValues("GLN", "ALA", -1)).toBeLessThan(0);
  });

  it("direction flips the numeric order", () => {
    expect(compareCellValues("1", "2", -1)).toBeGreaterThan(0);
  });

  it("missing cells sort last in both directions", () => {
    expect(compareCellValues(undefined, "1", 1)).toBeGreaterThan(0);
    expect(compareCellValues(undefined, "1", -1)).toBeGreaterThan(0);
    expect(compareCellValues("1", undefined, 1)).toBeLessThan(0);
    expect(compareCellValues(undefined, undefined, 1)).toBe(0);
  });
});

describe("filterIndices", () => {
  it("keeps only passing indices, in order", () => {
    const kept = filterIndices(6, (i) => i % 2 === 0);
    expect(Array.from(kept)).toEqual([0, 2, 4]);
  });

  it("returns empty for zero count", () => {
    expect(filterIndices(0, () => true).length).toBe(0);
  });
});

describe("sortIndices", () => {
  const keys = Float64Array.from([3, 1, 2]);

  it("argsorts the identity range when base is null", () => {
    const sorted = sortIndices(null, 3, (a, b) => keys[a] - keys[b]);
    expect(Array.from(sorted)).toEqual([1, 2, 0]);
  });

  it("argsorts a filtered base without mutating it", () => {
    const base = Uint32Array.from([0, 2]);
    const sorted = sortIndices(base, 3, (a, b) => keys[a] - keys[b]);
    expect(Array.from(sorted)).toEqual([2, 0]);
    expect(Array.from(base)).toEqual([0, 2]);
  });
});
