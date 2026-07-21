import { Block, Box, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { computeRdf } from "../src/analysis/rdf";

function makeFrame(positions: [number, number, number][]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(positions.map((p) => p[0])));
  atoms.setColF("y", new Float64Array(positions.map((p) => p[1])));
  atoms.setColF("z", new Float64Array(positions.map((p) => p[2])));
  atoms.setColStr(
    "element",
    positions.map(() => "Ar"),
  );
  frame.insertBlock("atoms", atoms);
  return frame;
}

function makePeriodicFrame(
  positions: [number, number, number][],
  boxSize: number,
): Frame {
  const frame = makeFrame(positions);
  const box = Box.cube(boxSize, new Float64Array([0, 0, 0]), true, true, true);
  frame.box = box;
  return frame;
}

describe("computeRdf", () => {
  it("returns null for empty frame", () => {
    expect(() => computeRdf(new Frame())).not.toThrow();
    expect(computeRdf(new Frame())).toBe(null);
  });

  it("returns null for single atom (periodic)", () => {
    expect(computeRdf(makePeriodicFrame([[0, 0, 0]], 10))).toBe(null);
  });

  it("throws for non-periodic frame when volume is not provided", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    expect(() => computeRdf(frame, { nBins: 50 })).toThrow(/volume/i);
  });

  it("throws when explicit volume is non-positive", () => {
    const frame = makePeriodicFrame(
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      10,
    );
    expect(() => computeRdf(frame, { nBins: 50, volume: 0 })).toThrow(
      /volume/i,
    );
    expect(() => computeRdf(frame, { nBins: 50, volume: -1 })).toThrow(
      /volume/i,
    );
  });

  it("computes self-RDF for non-periodic atoms with explicit volume", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const result = computeRdf(frame, { nBins: 50, volume: 1000 });
    expect(result).not.toBe(null);
    expect(result?.nBins).toBe(50);
    expect(result?.nParticles).toBe(3);
    expect(result?.volume).toBeCloseTo(1000, 6);
    expect(result?.rMin).toBe(0);
  });

  it("computes RDF for periodic system via WASM", () => {
    const positions: [number, number, number][] = [];
    for (let ix = 0; ix < 3; ix++)
      for (let iy = 0; iy < 3; iy++)
        for (let iz = 0; iz < 3; iz++) positions.push([ix * 2, iy * 2, iz * 2]);

    const result = computeRdf(makePeriodicFrame(positions, 6), { nBins: 50 });
    expect(result).not.toBe(null);
    expect(result?.rMax).toBeCloseTo(3.0, 1);
    expect(result?.volume).toBeCloseTo(216, 6);
    const peakBin = Math.floor(2.0 / result?.dr);
    expect(result?.gr[peakBin]).toBeGreaterThan(1);
  });

  it("rMin > 0 shifts bins and zeros out pairs below rMin", () => {
    const result = computeRdf(
      makePeriodicFrame(
        [
          [0, 0, 0],
          [0.5, 0, 0],
          [2, 0, 0],
          [2.5, 0, 0],
        ],
        10,
      ),
      { nBins: 10, rMax: 3, rMin: 1 },
    );
    expect(result).not.toBe(null);
    expect(result?.rMin).toBe(1);
    expect(result?.r[0]).toBeCloseTo(1 + (3 - 1) / 10 / 2, 6);
    // No pairs with d<1 → bin[0] (spanning ~[1, 1.2]) should be empty for this
    // layout. molrs normalizes the empty bin to a denormal (~1e-308), so assert
    // numerical zero rather than bit-exact +0.
    expect(result?.counts[0]).toBeCloseTo(0, 10);
  });

  it("explicit volume overrides box volume", () => {
    const frame = makePeriodicFrame(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      10,
    );
    const withBox = computeRdf(frame, { nBins: 50 });
    const withOverride = computeRdf(frame, { nBins: 50, volume: 500 });
    expect(withBox?.volume).toBeCloseTo(1000, 6);
    expect(withOverride?.volume).toBeCloseTo(500, 6);
  });

  it("supports groupA self-RDF with explicit volume", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [5, 0, 0],
      [6, 0, 0],
    ]);
    const result = computeRdf(frame, {
      nBins: 50,
      groupA: [0, 1],
      volume: 1000,
    });
    expect(result).not.toBe(null);
    expect(result?.nParticles).toBe(2);
  });

  it("supports groupA + groupB cross-RDF with explicit volume", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [5, 0, 0],
      [6, 0, 0],
    ]);
    const result = computeRdf(frame, {
      nBins: 50,
      groupA: [0, 1],
      groupB: [2, 3],
      volume: 1000,
    });
    expect(result).not.toBe(null);
    expect(result?.nParticles).toBe(2);
  });
});
