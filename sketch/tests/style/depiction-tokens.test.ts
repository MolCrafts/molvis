import { describe, expect, it } from "@rstest/core";
import {
  DEPICTION_TOKENS,
  depictionInk,
  labelInset,
  labelMask,
  terminalCapAngles,
} from "../../src/style/depiction-tokens";

describe("depiction tokens", () => {
  it("scales label, stroke, and double-bond gap with the bond", () => {
    const small = depictionInk(40);
    const large = depictionInk(80);
    expect(large.fontPx).toBeCloseTo(small.fontPx * 2, 5);
    expect(large.lineWidth).toBeCloseTo(small.lineWidth * 2, 5);
    expect(large.doubleSpacingPx).toBeCloseTo(small.doubleSpacingPx * 2, 5);
    expect(large.wedgeHalfPx).toBeCloseTo(small.wedgeHalfPx * 2, 5);
    // ACS: the em is 10/14.4 of the bond, not a fixed pixel cap.
    expect(small.fontPx / small.bondPx).toBeCloseTo(
      DEPICTION_TOKENS.fontSizeRatio,
      5,
    );
    expect(small.doubleSpacingPx / small.bondPx).toBeCloseTo(
      DEPICTION_TOKENS.doubleBondSpacingRatio,
      5,
    );
  });

  it("keeps a thumbnail from collapsing below the raster floor", () => {
    const tiny = depictionInk(2);
    expect(tiny.fontPx).toBe(DEPICTION_TOKENS.fontMinPx);
    expect(tiny.lineWidth).toBe(DEPICTION_TOKENS.lineMinPx);
  });

  it("opens a terminal cap at the chain angle, not at 90 degrees", () => {
    const [left, ahead, right] = terminalCapAngles(0);
    const turn = (DEPICTION_TOKENS.chainAngleDeg * Math.PI) / 180;
    expect(left).toBeCloseTo(turn, 6);
    expect(ahead).toBeCloseTo(Math.PI, 6);
    expect(right).toBeCloseTo(-turn, 6);
    expect(Math.abs(ahead - left)).not.toBeCloseTo(Math.PI / 2, 2);
  });

  it("meets a wide label on the side the bond arrives from", () => {
    const font = 50;
    const mask = labelMask({ left: -29, right: 29 }, font, false);
    const origin = { x: 0, y: 0 };
    const below = labelInset(mask, origin, { x: 0, y: 100 });
    const side = labelInset(mask, origin, { x: 100, y: 0 });
    const pad = font * DEPICTION_TOKENS.labelPadEm;
    expect(mask.rect).not.toBeNull();
    expect(below).toBeCloseTo(font * DEPICTION_TOKENS.labelCapEm + pad, 5);
    expect(side).toBeCloseTo(29 + pad, 5);
    expect(below).toBeLessThan(side);
  });

  it("keeps a one-letter label a disk the size of the glyph", () => {
    const font = 50;
    const mask = labelMask({ left: -18.5, right: 18.5 }, font, false);
    expect(mask.rect).toBeNull();
    expect(mask.radius).toBeCloseTo(
      font * (DEPICTION_TOKENS.labelCapEm + DEPICTION_TOKENS.labelPadEm),
      5,
    );
  });
});
