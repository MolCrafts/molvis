import { describe, expect, it } from "@rstest/core";
import {
  buildCategoricalColorLookup,
  categoricalColorAt,
  getColorMap,
  getPaletteDefinition,
  hexToLinearRgb,
  listColorMaps,
  listContinuousColorMaps,
  listPaletteDefinitions,
} from "../../src/artist/palette";

describe("categorical palettes", () => {
  it("assigns dataset-level categorical colors independently of row order", () => {
    const a = buildCategoricalColorLookup(["opls_146", "opls_145", "opls_147"]);
    const b = buildCategoricalColorLookup(["opls_147", "opls_145", "opls_146"]);

    for (const key of ["opls_145", "opls_146", "opls_147"]) {
      expect(a.get(key)).toEqual(b.get(key));
    }
  });

  it("uses natural ordering when assigning categorical colors", () => {
    const lookup = buildCategoricalColorLookup(["opls_10", "opls_2", "opls_1"]);
    expect(lookup.get("opls_1")).toEqual(hexToLinearRgb("#4E79A7"));
    expect(lookup.get("opls_2")).toEqual(hexToLinearRgb("#F28E2B"));
    expect(lookup.get("opls_10")).toEqual(hexToLinearRgb("#E15759"));
  });

  it("keeps a single internal continuous ramp for numeric data", () => {
    expect(listContinuousColorMaps()).toEqual(["viridis"]);
  });

  it("returns palette summaries and definitions for public palettes", () => {
    expect(listPaletteDefinitions()).toEqual([
      { name: "cpk", kind: "element", size: 118 },
      { name: "ovito", kind: "categorical", size: 9 },
      { name: "vivid", kind: "element", size: 118 },
    ]);

    const cpk = getPaletteDefinition("cpk");
    expect(cpk.entries[0]).toEqual({ label: "H", color: "#FFFFFF" });
  });

  it("exposes public ovito as the nine type colors, not the element table", () => {
    const names = listColorMaps();
    expect(names).toContain("ovito");
    expect(names).not.toContain("ovito-elements");

    const ovito = getPaletteDefinition("ovito");
    expect(ovito.entries[0]).toEqual({ label: "0", color: "#F7F7F7" });
    expect(ovito.entries[1]).toEqual({ label: "1", color: "#FF6666" });

    expect(getColorMap("ovito-elements").colorForKey("C")).toEqual(
      hexToLinearRgb("#909090"),
    );
    expect(() => getPaletteDefinition("ovito-elements")).toThrow(
      /ovito-elements/,
    );
  });

  it("categoricalColorAt is deterministic and distinct for first swatches", () => {
    expect(categoricalColorAt(0)).toEqual(categoricalColorAt(0));
    expect(categoricalColorAt(0)).not.toEqual(categoricalColorAt(1));
  });

  it("uses Jmol medium grey for element C (cpk / vivid / ovito-elements)", () => {
    for (const name of ["cpk", "vivid"] as const) {
      const def = getPaletteDefinition(name);
      const c = def.entries.find((e) => e.label === "C");
      const h = def.entries.find((e) => e.label === "H");
      expect(c?.color).toBe("#909090");
      expect(h?.color).toBe("#FFFFFF");
    }
    expect(getColorMap("ovito-elements").colorForKey("C")).toEqual(
      hexToLinearRgb("#909090"),
    );
    expect(getColorMap("ovito-elements").colorForKey("H")).toEqual(
      hexToLinearRgb("#FFFFFF"),
    );
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
