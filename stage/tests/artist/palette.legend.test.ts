import { describe, expect, it } from "@rstest/core";
import {
  buildCategoricalColorLookup,
  buildSourceColorLegend,
  type LinearRGB,
} from "../../src/artist/palette";

// Mirror of palette.ts's (non-exported) linearRgbToHex, used to verify that a
// legend entry's hex is the categorical-palette color for that ordinal.
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function expectedHex(rgb: LinearRGB): string {
  const toHex = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    const byte = Math.round(linearToSrgb(clamped) * 255);
    return byte.toString(16).padStart(2, "0");
  };
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`.toUpperCase();
}

describe("buildSourceColorLegend", () => {
  it("ac-008: one ascending entry per distinct source, hex tied to categorical ordinal", () => {
    const legend = buildSourceColorLegend([0, 1, 2]);
    expect(legend).toHaveLength(3);

    expect(legend.map((e) => e.sourceId)).toEqual([0, 1, 2]);

    for (const entry of legend) {
      expect(entry.hex).toMatch(/^#[0-9A-F]{6}$/);
    }

    const hexes = legend.map((e) => e.hex);
    expect(new Set(hexes).size).toBe(3);

    const lookup = buildCategoricalColorLookup(["0", "1", "2"]);
    for (let j = 0; j < 3; j++) {
      const rgb = lookup.get(String(j));
      expect(rgb).toBeTruthy();
      if (!rgb) continue;
      expect(legend[j].hex).toBe(expectedHex(rgb));
    }
  });

  it("ac-008: empty input yields empty legend", () => {
    expect(buildSourceColorLegend([])).toEqual([]);
  });

  it("ac-008: repeated/unsorted input dedups to ascending distinct sources", () => {
    const legend = buildSourceColorLegend([2, 0, 2, 1, 0]);
    expect(legend).toHaveLength(3);
    expect(legend.map((e) => e.sourceId)).toEqual([0, 1, 2]);
  });
});
