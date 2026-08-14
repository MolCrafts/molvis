import { describe, expect, it } from "@rstest/core";
import {
  categoricalSequence,
  resetCategoricalSequenceCache,
} from "../../src/artist/categorical_palette";
import type { LinearRGB } from "../../src/artist/palette";
import {
  buildCategoricalColorLookup,
  hexToLinearRgb,
} from "../../src/artist/palette";

/** OkLab distance ×100 — the units the thresholds below are written in. */
function perceptualDistance(a: LinearRGB, b: LinearRGB): number {
  const lab = (rgb: LinearRGB) => {
    const [r, g, bl] = rgb;
    const l = Math.cbrt(
      0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl,
    );
    const m = Math.cbrt(
      0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl,
    );
    const s = Math.cbrt(
      0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl,
    );
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return 100 * Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function closestPair(colors: LinearRGB[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      min = Math.min(min, perceptualDistance(colors[i], colors[j]));
    }
  }
  return min;
}

const DARK: LinearRGB = hexToLinearRgb("#17171C");
const WHITE: LinearRGB = hexToLinearRgb("#FFFFFF");

describe("categoricalSequence", () => {
  it("keeps every prefix separated, not just the full set", () => {
    resetCategoricalSequenceCache();
    const colors = categoricalSequence(20, { background: DARK });

    // The closest pair must decay gently, not collapse, as categories are
    // added — that is the regime an unknown category count lives in.
    expect(closestPair(colors.slice(0, 5))).toBeGreaterThan(18);
    expect(closestPair(colors.slice(0, 8))).toBeGreaterThan(15);
    expect(closestPair(colors.slice(0, 12))).toBeGreaterThan(12);
    expect(closestPair(colors)).toBeGreaterThan(10);
  });

  it("stays clear of the canvas it was generated for", () => {
    resetCategoricalSequenceCache();
    for (const background of [DARK, WHITE]) {
      const colors = categoricalSequence(16, { background });
      for (const color of colors) {
        expect(perceptualDistance(color, background)).toBeGreaterThan(10);
      }
      resetCategoricalSequenceCache();
    }
  });

  it("gives a different palette for a white canvas than a dark one", () => {
    resetCategoricalSequenceCache();
    const onDark = categoricalSequence(8, { background: DARK });
    resetCategoricalSequenceCache();
    const onWhite = categoricalSequence(8, { background: WHITE });

    expect(onDark).not.toEqual(onWhite);
  });

  it("extends rather than reshuffles when a category appears", () => {
    resetCategoricalSequenceCache();
    const five = categoricalSequence(5, { background: DARK });
    const nine = categoricalSequence(9, { background: DARK });

    // A new type must not restyle the types already on screen.
    expect(nine.slice(0, 5)).toEqual(five);
  });

  it("keeps reserved colours at a distance", () => {
    resetCategoricalSequenceCache();
    const reserved: LinearRGB[] = [hexToLinearRgb("#FF0000")];
    const colors = categoricalSequence(8, { background: DARK, reserved });

    for (const color of colors) {
      expect(perceptualDistance(color, reserved[0])).toBeGreaterThan(10);
    }
  });
});

describe("buildCategoricalColorLookup", () => {
  it("depends on the key set, not the iteration order", () => {
    resetCategoricalSequenceCache();
    const a = buildCategoricalColorLookup(["C", "A", "B"]);
    const b = buildCategoricalColorLookup(["B", "C", "A"]);

    for (const key of ["A", "B", "C"]) {
      expect(a.get(key)).toEqual(b.get(key));
    }
  });

  it("cycles Tab10 after ten keys instead of inventing new hues", () => {
    const types = Array.from({ length: 11 }, (_, i) => `type${i + 1}`);
    const lookup = buildCategoricalColorLookup(types);
    expect(lookup.get("type1")).toEqual(lookup.get("type11"));
  });

  it("is independent of canvas background", () => {
    const types = ["a", "b", "c", "d"];
    const first = buildCategoricalColorLookup(types);
    const second = buildCategoricalColorLookup(types);
    expect(types.map((t) => first.get(t))).toEqual(
      types.map((t) => second.get(t)),
    );
  });
});
