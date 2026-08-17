import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { computeRdf } from "../../src/analysis/rdf";
import { estimateRMax, estimateSelfPairCount } from "../../src/analysis/utils";

function makePeriodic(n: number, boxSize: number): Frame {
  const frame = new Frame();
  const atoms = new Block();
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const side = Math.ceil(Math.cbrt(n));
  const step = boxSize / side;
  for (let i = 0; i < n; i++) {
    x[i] = (i % side) * step;
    y[i] = (Math.floor(i / side) % side) * step;
    z[i] = Math.floor(i / (side * side)) * step;
  }
  atoms.setColF("x", x);
  atoms.setColF("y", y);
  atoms.setColF("z", z);
  frame.insertBlock("atoms", atoms);
  frame.box = Box.cube(boxSize, new Float64Array([0, 0, 0]), true, true, true);
  return frame;
}

function makeOpen(positions: [number, number, number][]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(positions.map((p) => p[0])));
  atoms.setColF("y", new Float64Array(positions.map((p) => p[1])));
  atoms.setColF("z", new Float64Array(positions.map((p) => p[2])));
  frame.insertBlock("atoms", atoms);
  return frame;
}

describe("estimateRMax", () => {
  it("uses 0.45 × min box length for periodic frames", () => {
    const frame = makePeriodic(27, 6);
    // 0.45 × 6 = 2.7; floor is 2.5 so result ≥ 2.5 and ≤ L/2
    const r = estimateRMax(frame);
    expect(r).toBeCloseTo(2.7, 5);
    expect(r).toBeLessThanOrEqual(3 + 1e-9);
  });

  it("stays at or below L/2", () => {
    const frame = makePeriodic(27, 6);
    expect(estimateRMax(frame)).toBeLessThanOrEqual(3 + 1e-9);
  });

  it("clamps huge dense boxes by pair budget / hard cap", () => {
    const frame = makePeriodic(2500, 66.58);
    const r = estimateRMax(frame);
    const half = 66.58 / 2;
    expect(r).toBeLessThan(half);
    expect(r).toBeLessThanOrEqual(50);
    expect(r).toBeGreaterThanOrEqual(2.5);
  });

  it("uses max pair distance for non-periodic frames", () => {
    const frame = makeOpen([
      [0, 0, 0],
      [10, 0, 0],
    ]);
    const r = estimateRMax(frame);
    // 10 × 1.05 pad
    expect(r).toBeCloseTo(10.5, 5);
  });
});

describe("estimateSelfPairCount", () => {
  it("grows with rMax³", () => {
    const a = estimateSelfPairCount(1000, 1000, 2);
    const b = estimateSelfPairCount(1000, 1000, 4);
    expect(b / a).toBeCloseTo(8, 0);
  });
});

describe("streaming RDF at moderate N", () => {
  it("computeRdf succeeds with explicit rMax on dense box", () => {
    const frame = makePeriodic(500, 10);
    const r = computeRdf(frame, { nBins: 40, rMax: 3 });
    expect(r).not.toBe(null);
    expect(r!.nParticles).toBe(500);
  });
});
