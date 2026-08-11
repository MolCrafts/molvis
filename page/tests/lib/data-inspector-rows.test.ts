import { describe, expect, it } from "@rstest/core";
import {
  INSPECTOR_ROW_HEIGHT_COARSE,
  INSPECTOR_ROW_HEIGHT_FINE,
  resolveInspectorRowHeight,
  rowIndexFromContentY,
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
