import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { computeRdf } from "../../src/analysis/rdf";
import type { RdfResult } from "../../src/analysis/rdf_params";
import {
  computeMsdTrajectory,
  computeRdfTrajectory,
} from "../../src/analysis/trajectory_analyses";
import type { AnalysisTrajectorySource } from "../../src/analysis/trajectory_runner";

// ---------------------------------------------------------------------------
// These are equivalence pins for the entry layer, not a second copy of the
// kernel tests: every RDF expectation is derived in-test by calling the
// single-frame `computeRdf` on the same frames, so the pin says "the multi-frame
// entry combines the per-frame kernel exactly this way" and cannot drift with
// the kernel. The MSD expectations are hard-coded — a rigid translation has a
// squared displacement you can write down.
// ---------------------------------------------------------------------------

type Position = readonly [number, number, number];

/** A frame of `Ar` atoms, optionally carrying the canonical `id` column. */
function makeFrame(positions: readonly Position[], ids?: readonly number[]) {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", Float64Array.from(positions.map((p) => p[0])));
  atoms.setColF("y", Float64Array.from(positions.map((p) => p[1])));
  atoms.setColF("z", Float64Array.from(positions.map((p) => p[2])));
  atoms.setColStr(
    "element",
    positions.map(() => "Ar"),
  );
  if (ids) atoms.setColU32("id", Uint32Array.from(ids));
  frame.insertBlock("atoms", atoms);
  return frame;
}

/** The same, inside a cubic periodic cell — so g(r) has a reference volume. */
function makePeriodicFrame(
  positions: readonly Position[],
  boxSize: number,
  ids?: readonly number[],
): Frame {
  const frame = makeFrame(positions, ids);
  // `Frame.box` MOVES the handle — build a fresh Box per attach.
  frame.box = Box.cube(boxSize, new Float64Array([0, 0, 0]), true, true, true);
  return frame;
}

/**
 * The frames of a run, as the structural source both entry points take.
 *
 * Frames stay owned by the test (the source hands them out, never frees them),
 * which is the same contract the live trajectory and the worker's snapshot
 * source honour.
 */
class FrameListSource implements AnalysisTrajectorySource {
  constructor(private readonly frames: readonly Frame[]) {}

  get length(): number {
    return this.frames.length;
  }

  async frame(index: number): Promise<Frame> {
    const frame = this.frames[index];
    if (!frame) throw new Error(`FrameListSource: no frame at index ${index}`);
    return frame;
  }
}

/** Await a run expected to reject, and hand back its `Error` type-safely. */
async function rejection(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`expected an Error, got ${String(error)}`);
  }
  throw new Error("expected the run to reject, but it resolved");
}

function requireResult<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`expected ${what}, got null`);
  return value;
}

function requireRdf(value: RdfResult | null, what: string): RdfResult {
  if (value === null) throw new Error(`expected ${what}, got null`);
  return value;
}

/** rMax 4 / nBins 40 → dr = 0.1 Å, well inside 0.45 × the 10 Å cell. */
const RDF_PARAMS = { rMax: 4, nBins: 40 } as const;
const BOX = 10;

describe("TestComputeRdfTrajectory", () => {
  it("averages g(r) per bin across frames while summing raw counts", async () => {
    const first = makePeriodicFrame(
      [
        [0, 0, 0],
        [2, 0, 0],
        [0, 2.5, 0],
        [0, 0, 3],
      ],
      BOX,
    );
    const second = makePeriodicFrame(
      [
        [0, 0, 0],
        [1.5, 0, 0],
        [0, 3, 0],
        [0, 0, 2],
      ],
      BOX,
    );

    const goldenFirst = requireRdf(
      computeRdf(first, RDF_PARAMS),
      "a histogram for frame 0",
    );
    const goldenSecond = requireRdf(
      computeRdf(second, RDF_PARAMS),
      "a histogram for frame 1",
    );

    const run = requireResult(
      await computeRdfTrajectory(
        new FrameListSource([first, second]),
        RDF_PARAMS,
      ),
      "an RDF trajectory result",
    );

    expect(run.perFrame.map((item) => item.frameIndex)).toEqual([0, 1]);
    expect(run.failures).toEqual([]);
    expect(run.trackedGroupA.mode).toBe("all");
    expect(run.trackedGroupB).toBe(undefined);
    expect(run.average.nBins).toBe(40);

    for (let i = 0; i < run.average.nBins; i++) {
      // g(r), shell density and the presented series are frame means…
      expect(run.average.gr[i]).toBeCloseTo(
        (goldenFirst.gr[i] + goldenSecond.gr[i]) / 2,
        10,
      );
      expect(run.average.density[i]).toBeCloseTo(
        (goldenFirst.density[i] + goldenSecond.density[i]) / 2,
        10,
      );
      expect(run.average.y[i]).toBeCloseTo(
        (goldenFirst.y[i] + goldenSecond.y[i]) / 2,
        10,
      );
      // …while raw pair counts are the total occupancy over the range.
      expect(run.average.counts[i]).toBeCloseTo(
        goldenFirst.counts[i] + goldenSecond.counts[i],
        10,
      );
    }
  });

  it("follows group A and group B subsets across a reordered frame", async () => {
    // Atoms 1..4 at fixed positions; the second frame lists the same four atoms
    // in the order 2, 4, 1, 3 — the kind of reshuffle a dump writer produces.
    const p1: Position = [0, 0, 0];
    const p2: Position = [1, 0, 0];
    const p3: Position = [0, 2, 0];
    const p4: Position = [0, 0, 3];
    const ordered = makePeriodicFrame([p1, p2, p3, p4], BOX, [1, 2, 3, 4]);
    const shuffled = makePeriodicFrame([p2, p4, p1, p3], BOX, [2, 4, 1, 3]);

    const run = requireResult(
      await computeRdfTrajectory(new FrameListSource([ordered, shuffled]), {
        ...RDF_PARAMS,
        groupASelection: { kind: "indices", indices: [0, 1] },
        groupBSelection: { kind: "indices", indices: [2, 3] },
      }),
      "an RDF trajectory result",
    );

    expect(run.trackedGroupA.mode).toBe("id-column");
    expect(run.trackedGroupB?.mode).toBe("id-column");
    expect(run.failures).toEqual([]);
    expect(run.perFrame.map((item) => item.frameIndex)).toEqual([0, 1]);

    // Group A is atoms 1,2 and group B is atoms 3,4 — in the shuffled frame
    // that is rows [2,0] and [3,1], NOT the reference rows [0,1] / [2,3]
    // (which would histogram {2,4} against {1,3} and give a different answer).
    const goldenOrdered = requireRdf(
      computeRdf(ordered, { ...RDF_PARAMS, groupA: [0, 1], groupB: [2, 3] }),
      "a histogram for the ordered frame",
    );
    const goldenShuffled = requireRdf(
      computeRdf(shuffled, { ...RDF_PARAMS, groupA: [2, 0], groupB: [3, 1] }),
      "a histogram for the shuffled frame",
    );
    const rowIndexGolden = requireRdf(
      computeRdf(shuffled, { ...RDF_PARAMS, groupA: [0, 1], groupB: [2, 3] }),
      "a row-index histogram for the shuffled frame",
    );

    const shuffledCounts = Array.from(run.perFrame[1].result.counts);
    expect(shuffledCounts).toEqual(Array.from(goldenShuffled.counts));
    // The pin only bites if tracking and not-tracking actually differ here.
    expect(shuffledCounts).not.toEqual(Array.from(rowIndexGolden.counts));
    expect(Array.from(run.perFrame[0].result.counts)).toEqual(
      Array.from(goldenOrdered.counts),
    );
  });

  it("records a bad frame in failures and finishes the rest of the run", async () => {
    // The middle frame has no cell, so g(r) has nothing to normalise against
    // and the kernel raises — a frame that fails on its own, not a bad run.
    const source = new FrameListSource([
      makePeriodicFrame(
        [
          [0, 0, 0],
          [2, 0, 0],
          [0, 2, 0],
        ],
        BOX,
      ),
      makeFrame([
        [0, 0, 0],
        [2, 0, 0],
        [0, 2, 0],
      ]),
      makePeriodicFrame(
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        BOX,
      ),
    ]);

    const run = requireResult(
      await computeRdfTrajectory(source, {
        ...RDF_PARAMS,
        representation: "gr",
      }),
      "an RDF trajectory result",
    );

    expect(run.failures).toHaveLength(1);
    expect(run.failures[0].frameIndex).toBe(1);
    expect(run.perFrame.map((item) => item.frameIndex)).toEqual([0, 2]);
  });

  it("rethrows the first failure when every frame failed", async () => {
    const source = new FrameListSource([
      makeFrame([
        [0, 0, 0],
        [2, 0, 0],
      ]),
      makeFrame([
        [0, 0, 0],
        [3, 0, 0],
      ]),
    ]);

    const error = await rejection(
      computeRdfTrajectory(source, { ...RDF_PARAMS, representation: "gr" }),
    );

    // A real cause beats a silent null the UI would render as "not enough atoms".
    expect(error.message).toMatch(/volume|reference/i);
  });
});

describe("TestComputeMsdTrajectory", () => {
  /** Two atoms on the x axis, rigidly translated by `shift` Å. */
  function translated(shift: number): Frame {
    return makeFrame([
      [shift, 0, 0],
      [shift + 1, 0, 0],
    ]);
  }

  it("reports the squared displacement of a rigid translation per frame", async () => {
    const source = new FrameListSource([
      translated(0),
      translated(1),
      translated(4),
    ]);

    const run = requireResult(
      await computeMsdTrajectory(source),
      "an MSD trajectory result",
    );

    // Every atom moves with the frame, so MSD = shift²: 0, 1² and 4².
    expect(run.result.count).toBe(3);
    expect(run.result.frames.map((item) => item.mean)).toEqual([0, 1, 16]);
    expect(Array.from(run.result.frames[2].perParticle)).toEqual([16, 16]);
    expect(run.frameIndices).toEqual([0, 1, 2]);
    expect(run.failures).toEqual([]);
    expect(run.trackedSelection.mode).toBe("all");
  });

  it("reports frameIndices in feed order for a strided range", async () => {
    const source = new FrameListSource([
      translated(0),
      translated(1),
      translated(2),
      translated(3),
      translated(4),
    ]);

    const run = requireResult(
      await computeMsdTrajectory(
        source,
        {},
        { frameRange: { start: 0, endInclusive: 4, stride: 2 } },
      ),
      "an MSD trajectory result",
    );

    expect(run.frameIndices).toEqual([0, 2, 4]);
    // Frames 0, 2, 4 sit 0, 2 and 4 Å from the reference.
    expect(run.result.frames.map((item) => item.mean)).toEqual([0, 4, 16]);
  });

  it("returns null when fewer than two frames were requested", async () => {
    expect(
      await computeMsdTrajectory(new FrameListSource([translated(0)])),
    ).toBe(null);
    expect(
      await computeMsdTrajectory(
        new FrameListSource([translated(0), translated(1), translated(2)]),
        {},
        { frameRange: { start: 1, endInclusive: 1 } },
      ),
    ).toBe(null);
  });

  it("rejects with AnalysisAbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await rejection(
      computeMsdTrajectory(
        new FrameListSource([translated(0), translated(1), translated(2)]),
        {},
        { abortSignal: controller.signal },
      ),
    );

    expect(error.name).toBe("AnalysisAbortError");
  });
});
