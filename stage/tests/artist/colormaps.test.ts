import { describe, expect, it } from "@rstest/core";
import { getColorMap, listContinuousColorMaps } from "../../src/artist/palette";

describe("sampleColormap", () => {
  it("only keeps viridis as the internal continuous ramp", () => {
    expect(listContinuousColorMaps()).toEqual(["viridis"]);
  });

  it("should return values in [0,1] at t=0", () => {
    const [r, g, b] = getColorMap("viridis").sample(0);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });

  it("should return values in [0,1] at t=1", () => {
    const [r, g, b] = getColorMap("viridis").sample(1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });

  it("should return values in [0,1] at t=0.5", () => {
    const [r, g, b] = getColorMap("viridis").sample(0.5);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });

  it("should clamp t < 0 to t=0", () => {
    const atZero = getColorMap("viridis").sample(0);
    const atNeg = getColorMap("viridis").sample(-1);
    expect(atNeg[0]).toBeCloseTo(atZero[0], 5);
    expect(atNeg[1]).toBeCloseTo(atZero[1], 5);
    expect(atNeg[2]).toBeCloseTo(atZero[2], 5);
  });

  it("should clamp t > 1 to t=1", () => {
    const atOne = getColorMap("viridis").sample(1);
    const atOver = getColorMap("viridis").sample(2);
    expect(atOver[0]).toBeCloseTo(atOne[0], 5);
    expect(atOver[1]).toBeCloseTo(atOne[1], 5);
    expect(atOver[2]).toBeCloseTo(atOne[2], 5);
  });

  it("should stay colorful through the middle of the ramp", () => {
    const [r, g, b] = getColorMap("viridis").sample(0.5);
    expect(r + g + b).toBeGreaterThan(0.4);
  });
});
