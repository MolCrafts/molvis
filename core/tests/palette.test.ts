import { describe, expect, it } from "@rstest/core";
import {
  buildCategoricalColorLookup,
  DEFAULT_CATEGORICAL_COLOR_MAP,
  getCategoricalPalette,
  getColorMap,
  getPaletteDefinition,
  hexToLinearRgb,
  listColorMaps,
  listContinuousColorMaps,
  listPaletteDefinitions,
} from "../src/artist/palette";

describe("categorical palettes", () => {
  it("registers tableau-soft as the default categorical palette", () => {
    const palette = getCategoricalPalette();
    expect(getColorMap(DEFAULT_CATEGORICAL_COLOR_MAP).kind).toBe("categorical");
    expect(palette.length).toBe(20);
    expect(DEFAULT_CATEGORICAL_COLOR_MAP).toBe("tableau-soft");
  });

  it("keeps glasbey-vivid available for many-category data", () => {
    expect(getColorMap("glasbey-vivid").kind).toBe("categorical");
    expect(getCategoricalPalette("glasbey-vivid").length).toBe(256);
  });

  it("keeps all tableau-soft colors unique", () => {
    const palette = getCategoricalPalette();
    const serialized = palette.map((rgb) => rgb.join(","));
    expect(new Set(serialized).size).toBe(palette.length);
  });

  it("generates non-colliding soft colors beyond the curated palette", () => {
    const palette = getCategoricalPalette();
    const keys = Array.from({ length: palette.length + 5 }, (_, i) => `t${i}`);
    const lookup = buildCategoricalColorLookup(keys);
    const serialized = keys.map((k) => lookup.get(k)?.join(","));
    // No wrap/collision: every category gets a distinct color, and the
    // generated overflow stays inside [0,1].
    expect(new Set(serialized).size).toBe(keys.length);
    for (const rgb of lookup.values()) {
      for (const c of rgb) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns values in [0,1] for categorical colors", () => {
    const cm = getColorMap(DEFAULT_CATEGORICAL_COLOR_MAP);
    const [r, g, b] = cm.colorForKey("opls_145");
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });

  it("keeps colorForKey deterministic for the same key", () => {
    const cm = getColorMap(DEFAULT_CATEGORICAL_COLOR_MAP);
    const a = cm.colorForKey("opls_145");
    const b = cm.colorForKey("opls_145");
    expect(a[0]).toBeCloseTo(b[0], 10);
    expect(a[1]).toBeCloseTo(b[1], 10);
    expect(a[2]).toBeCloseTo(b[2], 10);
  });

  it("assigns dataset-level categorical colors independently of row order", () => {
    const a = buildCategoricalColorLookup(["opls_146", "opls_145", "opls_147"]);
    const b = buildCategoricalColorLookup(["opls_147", "opls_145", "opls_146"]);

    for (const key of ["opls_145", "opls_146", "opls_147"]) {
      expect(a.get(key)).toEqual(b.get(key));
    }
  });

  it("uses natural ordering when assigning categorical colors", () => {
    const palette = getCategoricalPalette();
    const lookup = buildCategoricalColorLookup(["opls_10", "opls_2", "opls_1"]);
    expect(lookup.get("opls_1")).toEqual(palette[0]);
    expect(lookup.get("opls_2")).toEqual(palette[1]);
    expect(lookup.get("opls_10")).toEqual(palette[2]);
  });

  it("only exposes the element palettes and the default categorical palette", () => {
    expect(() => getColorMap("tol-bright")).toThrow();
    expect(() => getColorMap("tableau10")).toThrow();
    expect(listColorMaps()).toEqual([
      "cpk",
      "glasbey-vivid",
      "ovito",
      DEFAULT_CATEGORICAL_COLOR_MAP,
      "vivid",
    ]);
  });

  it("keeps a single internal continuous ramp for numeric data", () => {
    expect(listContinuousColorMaps()).toEqual(["viridis"]);
  });

  it("returns palette summaries and definitions for public palettes", () => {
    expect(listPaletteDefinitions()).toEqual([
      { name: "cpk", kind: "element", size: 118 },
      { name: "glasbey-vivid", kind: "categorical", size: 256 },
      { name: "ovito", kind: "element", size: 118 },
      { name: DEFAULT_CATEGORICAL_COLOR_MAP, kind: "categorical", size: 20 },
      { name: "vivid", kind: "element", size: 118 },
    ]);

    const cpk = getPaletteDefinition("cpk");
    expect(cpk.entries[0]).toEqual({ label: "H", color: "#FFFFFF" });

    const soft = getPaletteDefinition(DEFAULT_CATEGORICAL_COLOR_MAP);
    expect(soft.entries[0]).toEqual({ label: "1", color: "#4E79A7" });
  });
});

describe("hexToLinearRgb", () => {
  it("converts black correctly", () => {
    const [r, g, b] = hexToLinearRgb("#000000");
    expect(r).toBeCloseTo(0, 5);
    expect(g).toBeCloseTo(0, 5);
    expect(b).toBeCloseTo(0, 5);
  });

  it("converts white correctly", () => {
    const [r, g, b] = hexToLinearRgb("#FFFFFF");
    expect(r).toBeCloseTo(1, 3);
    expect(g).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(1, 3);
  });

  it("returns values in [0, 1]", () => {
    const [r, g, b] = hexToLinearRgb("#8844CC");
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });

  it("applies sRGB-to-linear conversion (not just divide by 255)", () => {
    const [r] = hexToLinearRgb("#808080");
    expect(r).toBeLessThan(0.3);
    expect(r).toBeGreaterThan(0.15);
  });

  it("handles hex without # prefix", () => {
    const [r1, g1, b1] = hexToLinearRgb("#FF0000");
    const [r2, g2, b2] = hexToLinearRgb("FF0000");
    expect(r1).toBeCloseTo(r2, 5);
    expect(g1).toBeCloseTo(g2, 5);
    expect(b1).toBeCloseTo(b2, 5);
  });
});
