import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { computeRdf } from "../../src/analysis/rdf";
import {
  estimateBoundingBoxVolume,
  estimateBoundingSphereVolume,
  estimateNBins,
  resolvePairRepresentation,
} from "../../src/analysis/rdf_params";

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

describe("resolvePairRepresentation", () => {
  it("auto → gr when frame has a box", () => {
    const frame = makePeriodicFrame(
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      10,
    );
    expect(resolvePairRepresentation(frame, "auto")).toBe("gr");
  });

  it("auto → pair when frame has no box", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(resolvePairRepresentation(frame, "auto")).toBe("pair");
  });
});

describe("estimateNBins", () => {
  it("targets ~0.02 Å bin width", () => {
    expect(estimateNBins(2)).toBe(100);
    expect(estimateNBins(1)).toBe(50);
  });

  it("clamps to [10, 500]", () => {
    expect(estimateNBins(0.05)).toBe(10);
    expect(estimateNBins(100)).toBe(500);
  });
});

describe("computeRdf", () => {
  it("returns null for empty frame", () => {
    expect(computeRdf(new Frame(), { rMax: 5 })).toBe(null);
  });

  it("returns null for single atom (periodic)", () => {
    expect(computeRdf(makePeriodicFrame([[0, 0, 0]], 10), { rMax: 5 })).toBe(
      null,
    );
  });

  it("auto rMax works for periodic frames", () => {
    const frame = makePeriodicFrame(
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      10,
    );
    const result = computeRdf(frame, { nBins: 50 });
    expect(result).not.toBe(null);
    // 0.45 × 10 = 4.5
    expect(result?.rMax).toBeCloseTo(4.5, 5);
    expect(result?.representation).toBe("gr");
    expect(result?.yLabel).toBe("g(r)");
    expect(result?.hasReferenceVolume).toBe(true);
  });

  it("non-periodic auto defaults to pair distribution without volume", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const result = computeRdf(frame, { nBins: 50, rMax: 5 });
    expect(result).not.toBe(null);
    expect(result?.representation).toBe("pair");
    expect(result?.yLabel).toBe("p(r)");
    expect(result?.hasReferenceVolume).toBe(false);
    expect(Number.isNaN(result!.volume)).toBe(true);
    // y mirrors counts
    for (let i = 0; i < result!.nBins; i++) {
      expect(result!.y[i]).toBe(result!.counts[i]);
    }
  });

  it("throws for non-periodic g(r) when volume is not provided", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    expect(() =>
      computeRdf(frame, { nBins: 50, rMax: 5, representation: "gr" }),
    ).toThrow(/volume|reference/i);
  });

  it("throws when explicit volume is non-positive", () => {
    const frame = makePeriodicFrame(
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      10,
    );
    expect(() => computeRdf(frame, { nBins: 50, rMax: 5, volume: 0 })).toThrow(
      /volume/i,
    );
    expect(() => computeRdf(frame, { nBins: 50, rMax: 5, volume: -1 })).toThrow(
      /volume/i,
    );
  });

  it("computes g(r) for non-periodic atoms with explicit volume", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const result = computeRdf(frame, {
      nBins: 50,
      rMax: 5,
      volume: 1000,
      representation: "gr",
    });
    expect(result).not.toBe(null);
    expect(result?.nBins).toBe(50);
    expect(result?.nParticles).toBe(3);
    expect(result?.volume).toBeCloseTo(1000, 6);
    expect(result?.rMin).toBe(0);
    expect(result?.representation).toBe("gr");
    expect(result?.hasReferenceVolume).toBe(true);
  });

  it("computes density without volume on non-periodic frames", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const result = computeRdf(frame, {
      nBins: 50,
      rMax: 5,
      representation: "density",
    });
    expect(result).not.toBe(null);
    expect(result?.representation).toBe("density");
    expect(result?.yLabel).toBe("ρ(r)");
    expect(result?.hasReferenceVolume).toBe(false);
    // density = counts / (4π r² dr)
    for (let i = 0; i < result!.nBins; i++) {
      const shell = 4 * Math.PI * result!.r[i] ** 2 * result!.dr;
      expect(result!.density[i]).toBeCloseTo(
        shell > 0 ? result!.counts[i] / shell : 0,
        10,
      );
      expect(result!.y[i]).toBe(result!.density[i]);
    }
  });

  it("computes RDF for periodic system via WASM (streaming)", () => {
    const positions: [number, number, number][] = [];
    for (let ix = 0; ix < 3; ix++)
      for (let iy = 0; iy < 3; iy++)
        for (let iz = 0; iz < 3; iz++) positions.push([ix * 2, iy * 2, iz * 2]);

    const result = computeRdf(makePeriodicFrame(positions, 6), {
      nBins: 50,
      rMax: 3,
    });
    expect(result).not.toBe(null);
    expect(result?.rMax).toBeCloseTo(3.0, 1);
    expect(result?.volume).toBeCloseTo(216, 6);
    expect(result?.representation).toBe("gr");
    const peakBin = Math.floor(2.0 / result!.dr);
    expect(result?.gr[peakBin]).toBeGreaterThan(1);
    expect(result?.y[peakBin]).toBe(result!.gr[peakBin]);
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
    const withBox = computeRdf(frame, { nBins: 50, rMax: 5 });
    const withOverride = computeRdf(frame, {
      nBins: 50,
      rMax: 5,
      volume: 500,
    });
    expect(withBox?.volume).toBeCloseTo(1000, 6);
    expect(withOverride?.volume).toBeCloseTo(500, 6);
  });

  it("supports groupA self-histogram with pair mode (no volume)", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [5, 0, 0],
      [6, 0, 0],
    ]);
    const result = computeRdf(frame, {
      nBins: 50,
      rMax: 5,
      groupA: [0, 1],
      representation: "pair",
    });
    expect(result).not.toBe(null);
    expect(result?.nParticles).toBe(2);
    expect(result?.representation).toBe("pair");
  });

  it("supports groupA + groupB cross with explicit volume g(r)", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [5, 0, 0],
      [6, 0, 0],
    ]);
    const result = computeRdf(frame, {
      nBins: 50,
      rMax: 5,
      groupA: [0, 1],
      groupB: [2, 3],
      volume: 1000,
      representation: "gr",
    });
    expect(result).not.toBe(null);
    expect(result?.nParticles).toBe(2);
  });

  it("survives reading frame.box volume without free() (handle ownership)", () => {
    const frame = makePeriodicFrame(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      10,
    );
    const box = frame.box;
    expect(box).toBeTruthy();
    const vol = box!.volume();
    expect(vol).toBeCloseTo(1000, 6);
    const result = computeRdf(frame, { nBins: 50, rMax: 5 });
    expect(result).not.toBe(null);
    expect(result?.volume).toBeCloseTo(1000, 6);
    expect(result?.nParticles).toBe(3);
  });

  it("self-group RDF works without an element column (LAMMPS dumps)", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1, 2, 3]));
    atoms.setColF("y", new Float64Array([0, 0, 1, 1]));
    atoms.setColF("z", new Float64Array([0, 0, 0, 0]));
    frame.insertBlock("atoms", atoms);
    const box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);
    frame.box = box;
    const result = computeRdf(frame, {
      nBins: 50,
      rMax: 5,
      groupA: [0, 1, 2, 3],
    });
    expect(result).not.toBe(null);
    expect(result?.nParticles).toBe(4);
  });

  it("rejects non-positive rMax", () => {
    const frame = makePeriodicFrame(
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      10,
    );
    expect(() => computeRdf(frame, { nBins: 50, rMax: 0 })).toThrow(/rMax/i);
    expect(() => computeRdf(frame, { nBins: 50, rMax: -1 })).toThrow(/rMax/i);
  });
});

describe("reference volume estimators", () => {
  it("bounding box volume for a unit cube of points", () => {
    const frame = makeFrame([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1],
    ]);
    expect(estimateBoundingBoxVolume(frame)).toBeCloseTo(1, 6);
  });

  it("bounding sphere volume covers the farthest atom", () => {
    const frame = makeFrame([
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, 0],
    ]);
    // centroid at 0, radius 1 → V = 4/3 π
    expect(estimateBoundingSphereVolume(frame)).toBeCloseTo(
      (4 / 3) * Math.PI,
      5,
    );
  });
});
