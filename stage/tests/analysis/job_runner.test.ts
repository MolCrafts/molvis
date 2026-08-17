import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { runAnalysisJob } from "../../src/analysis/job_runner";
import { computeRdf } from "../../src/analysis/rdf";
import { AnalysisUnsupportedError } from "../../src/analysis/trajectory_runner";
import type { AnalysisFrameSnapshot } from "../../src/analysis/worker_protocol";
import { snapshotFrameForAnalysis } from "../../src/analysis/worker_protocol";

// ---------------------------------------------------------------------------
// Catalog ids. `AnalysisJobPayload.analysisId` is documented as
// `AnalysisDefinition.id`, i.e. the molrs compute-catalog key — the same string
// `dispatch.ts` and `page/src/ui/layout/LeftSidebar.tsx` already switch on.
// A short "rdf" / "msd" spelling would be a second id vocabulary (an alias
// list), which is exactly what one canonical name per thing forbids.
// ---------------------------------------------------------------------------

const RDF_ID = "rdf.radial_distribution";
const MSD_ID = "msd.mean_squared_displacement";
/**
 * A catalog analysis with no trajectory-level entry of its own: it reaches the
 * worker through `inputKind` dispatch, not through a per-id route.
 */
const CLUSTER_ID = "cluster.connected_components";
/** A `series` analysis: it needs velocity columns no snapshot carries. */
const POWER_SPECTRUM_ID = "spectroscopy.power_spectrum";

/** Cubic periodic cell (Å) big enough that only the primary image is in range. */
const BOX_LENGTHS = [20, 20, 20] as const;
const BOX_ORIGIN = [0, 0, 0] as const;

/** rMax 5 / nBins 50 → dr = 0.1 Å, so bin `b` spans [0.1·b, 0.1·(b+1)). */
const RDF_PARAMS = { rMax: 5, nBins: 50, rMin: 0 } as const;
const N_BINS = 50;

/**
 * Two atoms `separation` Å apart along x in the periodic cell above, as the
 * plain snapshot a worker job carries.
 */
function pairSnapshot(
  frameIndex: number,
  separation: number,
): AnalysisFrameSnapshot {
  return {
    frameIndex,
    x: Float64Array.from([0, separation]),
    y: Float64Array.from([0, 0]),
    z: Float64Array.from([0, 0]),
    elements: ["Ar", "Ar"],
    boxLengths: Float64Array.from(BOX_LENGTHS),
    boxOrigin: Float64Array.from(BOX_ORIGIN),
  };
}

/** The same two atoms as a real molrs frame, for the main-thread reference. */
function pairFrame(separation: number): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", Float64Array.from([0, separation]));
  atoms.setColF("y", Float64Array.from([0, 0]));
  atoms.setColF("z", Float64Array.from([0, 0]));
  atoms.setColStr("element", ["Ar", "Ar"]);
  frame.insertBlock("atoms", atoms);
  // `Frame.box` MOVES the handle — build a fresh Box per attach.
  frame.box = Box.ortho(
    Float64Array.from(BOX_LENGTHS),
    Float64Array.from(BOX_ORIGIN),
    true,
    true,
    true,
  );
  return frame;
}

// ---------------------------------------------------------------------------
// Triclinic fixture (hard-coded). LAMMPS cell `lx ly lz = 8 8 8`,
// `xy xz yz = 2 0 0`, i.e. a = (8,0,0), b = (2,8,0), c = (0,0,8) as the columns
// of a row-major h matrix. Atoms 0 and 1 sit either side of the **tilted** face,
// so the minimum image runs along `b` and the tilt actually moves the pair:
//
//   triclinic  |Δr| = |(-1.5, -1.0, 0)| = 1.803 Å → bin 18
//   squared to lengths [8, 8, 8]        = 1.118 Å → bin 11
//   squared to |a| |b| |c|              = 1.343 Å → bin 13
//
// Three different answers, so this fixture discriminates a carried tilt from
// either way of dropping it. Atoms 2 and 3 are a close pair inside the cell
// (0.539 Å → bin 5) that no cell convention can move.
// ---------------------------------------------------------------------------

const TRI_LENGTHS = [8, 8, 8] as const;
const TRI_TILTS = [2, 0, 0] as const;
const TRI_ORIGIN = [0, 0, 0] as const;
const TRI_X = [0.5, 1.0, 3.0, 3.4] as const;
const TRI_Y = [0.5, 7.5, 1.0, 1.3] as const;
const TRI_Z = [0.5, 0.5, 4.0, 4.2] as const;

/**
 * rMax 3.5 / nBins 35 → dr = 0.1 Å. 3.5 Å stays under half the smallest
 * perpendicular cell width (7.76 Å / 2 = 3.88 Å), so the minimum image is
 * unambiguous and the molrs cell list cannot double-count an image.
 */
const TRI_RDF_PARAMS = { rMax: 3.5, nBins: 35, rMin: 0 } as const;
const TRI_N_BINS = 35;
/** Bin of the tilt-crossing pair, and of the tilt-free close pair. */
const TRI_TILTED_BIN = 18;
const TRI_CLOSE_BIN = 5;
/** Where a squared cell would file the tilt-crossing pair instead. */
const TRI_SQUARED_BIN = 11;
const TRI_NORM_SQUARED_BIN = 13;

/** The four triclinic atoms as a real molrs frame (fresh Box per call). */
function triclinicFrame(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", Float64Array.from(TRI_X));
  atoms.setColF("y", Float64Array.from(TRI_Y));
  atoms.setColF("z", Float64Array.from(TRI_Z));
  atoms.setColStr("element", ["Ar", "Ar", "Ar", "Ar"]);
  frame.insertBlock("atoms", atoms);
  // Row-major h = hMatrixFromLammps(TRI_LENGTHS, TRI_TILTS). `Frame.box` MOVES
  // the handle, so every attach builds its own Box.
  const [lx, ly, lz] = TRI_LENGTHS;
  const [xy, xz, yz] = TRI_TILTS;
  frame.box = new Box(
    Float64Array.from([lx, xy, xz, 0, ly, yz, 0, 0, lz]),
    Float64Array.from(TRI_ORIGIN),
    true,
    true,
    true,
  );
  return frame;
}

/**
 * One atom at `x = frameIndex` Å, free boundary.
 *
 * No cell, so no minimum-image folding can touch the displacement, and the MSD
 * golden is the plain definition molrs documents:
 * `mean(t) = Σ|r_i(t) − r_i(0)|² / N` with `t` the frame ordinal (there is no
 * Δt in `MsdResult` — the series is indexed by fed frame).
 */
function msdSnapshot(frameIndex: number): AnalysisFrameSnapshot {
  return {
    frameIndex,
    x: Float64Array.from([frameIndex]),
    y: Float64Array.from([0]),
    z: Float64Array.from([0]),
    elements: ["Ar"],
    ids: Uint32Array.from([1]),
  };
}

// ---------------------------------------------------------------------------
// Lattice fixture (hard-coded) for the catalog shape-dispatch path: a 3×3×3
// simple cubic lattice at 2 Å spacing inside a 6 Å periodic cell. Every atom
// has a neighbor 2 Å away and the cell closes on itself, so under a 2.5 Å
// cutoff the whole frame is exactly one connected cluster of 27 atoms —
// a golden no partial neighbor search can reproduce.
// ---------------------------------------------------------------------------

const LATTICE_N = 3;
const LATTICE_SPACING = 2;
const LATTICE_BOX = 6;
const LATTICE_ATOM_COUNT = LATTICE_N ** 3;
const LATTICE_CUTOFF = 2.5;

/** The lattice above as the plain snapshot a worker job carries. */
function latticeSnapshot(frameIndex: number): AnalysisFrameSnapshot {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let ix = 0; ix < LATTICE_N; ix++) {
    for (let iy = 0; iy < LATTICE_N; iy++) {
      for (let iz = 0; iz < LATTICE_N; iz++) {
        xs.push(ix * LATTICE_SPACING);
        ys.push(iy * LATTICE_SPACING);
        zs.push(iz * LATTICE_SPACING);
      }
    }
  }
  return {
    frameIndex,
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    z: Float64Array.from(zs),
    elements: xs.map(() => "Ar"),
    boxLengths: Float64Array.from([LATTICE_BOX, LATTICE_BOX, LATTICE_BOX]),
    boxOrigin: Float64Array.from(BOX_ORIGIN),
  };
}

// ---------------------------------------------------------------------------
// Payload readers. `AnalysisJobResult.payload` is `unknown` by design (its
// shape belongs to the analysis), so each case narrows it through a checked
// reader instead of an `any` cast.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Float64Array) return `Float64Array(${value.length})`;
  if (Array.isArray(value)) return `Array(${value.length})`;
  return typeof value;
}

function asRecord(label: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} is not an object (got ${describeValue(value)})`);
  }
  return value;
}

function asArray(label: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is not an array (got ${describeValue(value)})`);
  }
  return value as unknown[];
}

function asF64(label: string, value: unknown): Float64Array {
  if (!(value instanceof Float64Array)) {
    throw new Error(
      `${label} is not a Float64Array (got ${describeValue(value)})`,
    );
  }
  return value;
}

function asNumber(label: string, value: unknown): number {
  if (typeof value !== "number") {
    throw new Error(`${label} is not a number (got ${describeValue(value)})`);
  }
  return value;
}

/** The lineSeries-shaped slice of one `RdfResult` (ac-002). */
interface RdfSeries {
  r: Float64Array;
  gr: Float64Array;
  y: Float64Array;
  counts: Float64Array;
}

interface RdfPayload {
  average: RdfSeries;
  perFrame: Array<{ frameIndex: number; result: RdfSeries }>;
}

function asRdfSeries(label: string, value: unknown): RdfSeries {
  const rec = asRecord(label, value);
  return {
    r: asF64(`${label}.r`, rec.r),
    gr: asF64(`${label}.gr`, rec.gr),
    y: asF64(`${label}.y`, rec.y),
    counts: asF64(`${label}.counts`, rec.counts),
  };
}

/** Reads the `RdfTrajectoryResult` shape (`average` + `perFrame`). */
function asRdfPayload(value: unknown): RdfPayload {
  const rec = asRecord("rdf payload", value);
  return {
    average: asRdfSeries("rdf payload.average", rec.average),
    perFrame: asArray("rdf payload.perFrame", rec.perFrame).map((entry, i) => {
      const item = asRecord(`rdf payload.perFrame[${i}]`, entry);
      return {
        frameIndex: asNumber(
          `rdf payload.perFrame[${i}].frameIndex`,
          item.frameIndex,
        ),
        result: asRdfSeries(`rdf payload.perFrame[${i}].result`, item.result),
      };
    }),
  };
}

interface MsdSeries {
  count: number;
  means: number[];
}

/**
 * Reads the MSD time series. `computeMsdTrajectory` nests its `MsdResult`
 * under `result`; a bare `MsdResult` is read too, because the goldens below
 * are about the series values, not about that nesting.
 */
function asMsdSeries(value: unknown): MsdSeries {
  const rec = asRecord("msd payload", value);
  const inner = isRecord(rec.result) ? rec.result : rec;
  const frames = asArray("msd payload.frames", inner.frames);
  return {
    count: asNumber("msd payload.count", inner.count),
    means: frames.map((entry, i) =>
      asNumber(
        `msd payload.frames[${i}].mean`,
        asRecord(`msd payload.frames[${i}]`, entry).mean,
      ),
    ),
  };
}

function asBoolean(label: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} is not a boolean (got ${describeValue(value)})`);
  }
  return value;
}

function asString(label: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`${label} is not a string (got ${describeValue(value)})`);
  }
  return value;
}

function asU32(label: string, value: unknown): Uint32Array {
  if (!(value instanceof Uint32Array)) {
    throw new Error(
      `${label} is not a Uint32Array (got ${describeValue(value)})`,
    );
  }
  return value;
}

/** One frame's failure as it crosses the wire: plain data, never an `Error`. */
interface ShapeFailure {
  frameIndex: number;
  message: string;
}

/** The `AnalysisShapeResult` envelope the shape-dispatch path answers with. */
interface ShapeResult {
  frameIndices: number[];
  perFrame: boolean;
  failures: ShapeFailure[];
  value: unknown;
}

/**
 * Reads the shape-dispatch envelope, rejecting an `Error` in `failures`.
 *
 * `Error` survives `postMessage` structurally but loses its prototype, so an
 * `AnalysisUnsupportedError` would arrive as a bare `Error` and every later
 * `instanceof` on it would answer the wrong thing. The wire carries the frame
 * index and the message instead, which is all a panel shows.
 */
function asShapeResult(value: unknown): ShapeResult {
  const rec = asRecord("shape payload", value);
  return {
    frameIndices: asArray("shape payload.frameIndices", rec.frameIndices).map(
      (entry, i) => asNumber(`shape payload.frameIndices[${i}]`, entry),
    ),
    perFrame: asBoolean("shape payload.perFrame", rec.perFrame),
    failures: asArray("shape payload.failures", rec.failures).map(
      (entry, i) => {
        const label = `shape payload.failures[${i}]`;
        if (entry instanceof Error) {
          throw new Error(`${label} is an Error instance, not wire data`);
        }
        const failure = asRecord(label, entry);
        return {
          frameIndex: asNumber(`${label}.frameIndex`, failure.frameIndex),
          message: asString(`${label}.message`, failure.message),
        };
      },
    ),
    value: rec.value,
  };
}

/** One `molrs.ClusterResult`, as `result_marshal` copies it out. */
interface ClusterPayload {
  frameIndex: number;
  clusterSizes: Uint32Array;
  numClusters: number;
}

/** Reads the per-frame entries of a per-frame shape-dispatch run. */
function asClusterFrames(value: unknown): ClusterPayload[] {
  return asArray("shape payload.value", value).map((entry, i) => {
    const label = `shape payload.value[${i}]`;
    const item = asRecord(label, entry);
    const result = asRecord(`${label}.value`, item.value);
    return {
      frameIndex: asNumber(`${label}.frameIndex`, item.frameIndex),
      clusterSizes: asU32(`${label}.value.clusterSizes`, result.clusterSizes),
      numClusters: asNumber(`${label}.value.numClusters`, result.numClusters),
    };
  });
}

/** Runs `job` and answers whatever it threw, so the case can inspect it. */
async function jobRejection(
  analysisId: string,
  params: Record<string, unknown>,
  frames: AnalysisFrameSnapshot[],
): Promise<unknown> {
  try {
    await runAnalysisJob({ analysisId, params, frames });
  } catch (error) {
    return error;
  }
  throw new Error(`${analysisId}: the job resolved instead of rejecting`);
}

describe("runAnalysisJob", () => {
  it("rdf on a single frame matches the main-thread computeRdf exactly", async () => {
    // Main-thread reference first: same two atoms, same cell, same params.
    const reference = computeRdf(pairFrame(1.0), { ...RDF_PARAMS });
    if (!reference)
      throw new Error("fixture: main-thread computeRdf gave null");

    const result = await runAnalysisJob({
      analysisId: RDF_ID,
      params: { ...RDF_PARAMS },
      frames: [pairSnapshot(0, 1.0)],
    });

    expect(result.analysisId).toBe(RDF_ID);
    expect(result.cancelled).toBe(false);
    expect(result.framesVisited).toEqual([0]);

    const payload = asRdfPayload(result.payload);

    // ac-002: the payload feeds the existing lineSeries chart unchanged —
    // r plus a y-series, both Float64Array of length nBins.
    expect(payload.average.r.length).toBe(N_BINS);
    expect(payload.average.gr.length).toBe(N_BINS);
    expect(payload.average.y.length).toBe(N_BINS);

    // ac-004 parity: both sides run the *same* molrs RDF kernel on the same
    // numbers, and a one-frame average divides by 1, so the true difference is
    // zero. 1e-12 is the position-class tolerance, kept as the stated bound.
    for (let i = 0; i < N_BINS; i++) {
      expect(
        Math.abs(payload.average.r[i] - reference.r[i]),
      ).toBeLessThanOrEqual(1e-12);
      expect(
        Math.abs(payload.average.gr[i] - reference.gr[i]),
      ).toBeLessThanOrEqual(1e-12);
      expect(
        Math.abs(payload.average.counts[i] - reference.counts[i]),
      ).toBeLessThanOrEqual(1e-12);
    }
  }, 30_000);

  it("rdf in a triclinic cell matches the main-thread computeRdf exactly", async () => {
    // Main-thread reference: the real tilted molrs frame, which is what the
    // pre-worker path computed and what a worker run has to reproduce.
    const reference = computeRdf(triclinicFrame(), { ...TRI_RDF_PARAMS });
    if (!reference)
      throw new Error("fixture: main-thread computeRdf gave null");

    // Hard-coded goldens (molrs RDF over this fixture, dr = 0.1 Å): the
    // minimum image of the tilt-crossing pair lands in bin 18 and nowhere a
    // squared cell would have put it. Asserted on the reference first, so a
    // fixture that stopped discriminating fails here rather than passing
    // vacuously.
    expect(reference.counts[TRI_TILTED_BIN]).toBeCloseTo(1, 12);
    expect(reference.counts[TRI_CLOSE_BIN]).toBeCloseTo(1, 12);
    expect(reference.counts[TRI_SQUARED_BIN]).toBeCloseTo(0, 12);
    expect(reference.counts[TRI_NORM_SQUARED_BIN]).toBeCloseTo(0, 12);

    // Worker side: the same frame packed onto the wire and rebuilt from plain
    // data. A wire that refuses or squares the tilt cannot get here.
    const result = await runAnalysisJob({
      analysisId: RDF_ID,
      params: { ...TRI_RDF_PARAMS },
      frames: [snapshotFrameForAnalysis(triclinicFrame(), 0)],
    });

    expect(result.cancelled).toBe(false);
    expect(result.framesVisited).toEqual([0]);

    const payload = asRdfPayload(result.payload);
    expect(payload.average.r.length).toBe(TRI_N_BINS);

    // Same molrs kernel on the same cell and the same coordinates, and a
    // one-frame average divides by 1, so the true difference is zero. 1e-12 is
    // the position-class tolerance, kept as the stated bound.
    for (let i = 0; i < TRI_N_BINS; i++) {
      expect(
        Math.abs(payload.average.r[i] - reference.r[i]),
      ).toBeLessThanOrEqual(1e-12);
      expect(
        Math.abs(payload.average.gr[i] - reference.gr[i]),
      ).toBeLessThanOrEqual(1e-12);
      expect(
        Math.abs(payload.average.counts[i] - reference.counts[i]),
      ).toBeLessThanOrEqual(1e-12);
    }
  }, 30_000);

  it("rdf accumulates over two frames", async () => {
    // Frame 0: pair at 1.05 Å → bin 10 (mid-bin, no edge ambiguity).
    // Frame 1: pair at 2.05 Å → bin 20.
    const NEAR_BIN = 10;
    const FAR_BIN = 20;

    const result = await runAnalysisJob({
      analysisId: RDF_ID,
      params: { ...RDF_PARAMS },
      frames: [pairSnapshot(0, 1.05), pairSnapshot(1, 2.05)],
    });

    expect(result.framesVisited).toEqual([0, 1]);

    const payload = asRdfPayload(result.payload);
    expect(payload.perFrame.length).toBe(2);
    expect(payload.perFrame.map((entry) => entry.frameIndex)).toEqual([0, 1]);

    const near = payload.perFrame.map((entry) => entry.result.counts[NEAR_BIN]);
    const far = payload.perFrame.map((entry) => entry.result.counts[FAR_BIN]);
    // Hard-coded goldens (molrs RDF over these fixtures, dr = 0.1 Å): each
    // frame contributes its single pair to one bin and nothing to the other,
    // so the two frames cannot be silently collapsed into one.
    expect(near).toEqual([1, 0]);
    expect(far).toEqual([0, 1]);
    // …and the trajectory totals follow from them.
    expect(payload.average.counts[NEAR_BIN]).toBeCloseTo(1, 10);
    expect(payload.average.counts[FAR_BIN]).toBeCloseTo(1, 10);

    // The averaged series (g(r) and the presented y) is the per-frame mean…
    for (const bin of [NEAR_BIN, FAR_BIN]) {
      const grMean =
        (payload.perFrame[0].result.gr[bin] +
          payload.perFrame[1].result.gr[bin]) /
        2;
      const yMean =
        (payload.perFrame[0].result.y[bin] +
          payload.perFrame[1].result.y[bin]) /
        2;
      expect(payload.average.gr[bin]).toBeCloseTo(grMean, 10);
      expect(payload.average.y[bin]).toBeCloseTo(yMean, 10);
      // …while `counts` stays the trajectory total, per `averageRdfResults`
      // in `analysis/trajectory_analyses.ts` ("keep total across frames").
      expect(payload.average.counts[bin]).toBeCloseTo(
        payload.perFrame[0].result.counts[bin] +
          payload.perFrame[1].result.counts[bin],
        10,
      );
    }
  }, 30_000);

  it("msd accumulates over three frames", async () => {
    const result = await runAnalysisJob({
      analysisId: MSD_ID,
      params: {},
      frames: [msdSnapshot(0), msdSnapshot(1), msdSnapshot(2)],
    });

    expect(result.analysisId).toBe(MSD_ID);
    expect(result.cancelled).toBe(false);
    expect(result.framesVisited).toEqual([0, 1, 2]);

    const series = asMsdSeries(result.payload);
    expect(series.count).toBe(3);
    // Hard-coded golden: one atom stepping +1 Å in x per frame, so
    // |Δr|² = 0, 1², 2² Å². Frame 0 is the reference and is exactly 0.
    expect(series.means.length).toBe(3);
    expect(series.means[0]).toBeCloseTo(0, 12);
    expect(series.means[1]).toBeCloseTo(1, 12);
    expect(series.means[2]).toBeCloseTo(4, 12);
  }, 30_000);

  it("cancel mid-run resolves cancelled without a payload", async () => {
    // ac-003: cooperative cancel between frames. The job still answers, so the
    // call resolves — it must never reject.
    let frameBeats = 0;
    const result = await runAnalysisJob(
      {
        analysisId: RDF_ID,
        params: { ...RDF_PARAMS },
        frames: [
          pairSnapshot(0, 1.05),
          pairSnapshot(1, 1.15),
          pairSnapshot(2, 1.25),
          pairSnapshot(3, 1.35),
        ],
      },
      (progress) => {
        if (progress.kind === "frame") frameBeats++;
      },
      () => frameBeats >= 1,
    );

    expect(result.cancelled).toBe(true);
    expect(result.payload).toBe(null);
    expect(result.framesVisited.length).toBeGreaterThanOrEqual(1);
    expect(result.framesVisited.length).toBeLessThan(4);
  }, 30_000);

  it("forwards one frame progress beat per visited frame", async () => {
    const beats: Array<{
      completed: number;
      total: number;
      frameIndex: number;
    }> = [];

    await runAnalysisJob(
      {
        analysisId: RDF_ID,
        params: { ...RDF_PARAMS },
        frames: [pairSnapshot(0, 1.05), pairSnapshot(1, 2.05)],
      },
      (progress) => {
        if (progress.kind !== "frame") return;
        beats.push({
          completed: progress.completed,
          total: progress.total,
          frameIndex: progress.frameIndex,
        });
      },
    );

    expect(beats).toEqual([
      { completed: 1, total: 2, frameIndex: 0 },
      { completed: 2, total: 2, frameIndex: 1 },
    ]);
  }, 30_000);

  it("rejects an unknown analysis id", async () => {
    await expect(
      runAnalysisJob({
        analysisId: "no-such-analysis",
        params: {},
        frames: [pairSnapshot(0, 1.05)],
      }),
    ).rejects.toThrow(/no-such-analysis/);
  }, 30_000);

  it("runs a catalog per-frame analysis through shape dispatch", async () => {
    // No trajectory-level entry exists for this id, so the only way it can run
    // is by its catalog `inputKind` — which is the point: the worker stops
    // enumerating ids and starts dispatching on shape.
    const result = await runAnalysisJob({
      analysisId: CLUSTER_ID,
      params: { cutoff: LATTICE_CUTOFF, minClusterSize: 1 },
      frames: [latticeSnapshot(0), latticeSnapshot(1)],
    });

    expect(result.analysisId).toBe(CLUSTER_ID);
    expect(result.cancelled).toBe(false);
    expect(result.framesVisited).toEqual([0, 1]);

    const payload = asShapeResult(result.payload);
    expect(payload.frameIndices).toEqual([0, 1]);
    expect(payload.perFrame).toBe(true);
    // Nothing failed here; the reader above is what proves a failure would be
    // `{ frameIndex, message }` rather than an `Error` on the wire.
    expect(payload.failures).toEqual([]);

    const frames = asClusterFrames(payload.value);
    expect(frames.map((frame) => frame.frameIndex)).toEqual([0, 1]);
    // Hard-coded golden (molrs connected components over the lattice fixture):
    // one cluster holding all 27 atoms, per frame.
    for (const frame of frames) {
      expect(frame.numClusters).toBe(1);
      expect(Array.from(frame.clusterSizes)).toEqual([LATTICE_ATOM_COUNT]);
    }
  }, 60_000);

  it("refuses a series analysis the snapshot cannot express", async () => {
    // A `series` analysis bins a velocity matrix stacked across frames, and an
    // `AnalysisFrameSnapshot` carries no velocity columns. The refusal has to
    // name what blocked it — "unsupported" alone sends the caller reading
    // kernel code.
    const error = await jobRejection(POWER_SPECTRUM_ID, {}, [
      pairSnapshot(0, 1.05),
      pairSnapshot(1, 1.15),
    ]);

    expect(error).toBeInstanceOf(AnalysisUnsupportedError);
    const unsupported = error as AnalysisUnsupportedError;
    expect(unsupported.analysisId).toBe(POWER_SPECTRUM_ID);
    expect(unsupported.message).toContain(POWER_SPECTRUM_ID);
    expect(unsupported.message).toMatch(/series|velocity/);
  }, 30_000);

  it("refuses an id the catalog does not carry, as an unsupported analysis", async () => {
    // The worker resolves the definition itself now, so an id with no catalog
    // entry is one more unsupported analysis — not "not available on the
    // worker", which described a hard-coded two-id menu that no longer exists.
    const error = await jobRejection("no-such-analysis", {}, [
      pairSnapshot(0, 1.05),
    ]);

    expect(error).toBeInstanceOf(AnalysisUnsupportedError);
    const unsupported = error as AnalysisUnsupportedError;
    expect(unsupported.analysisId).toBe("no-such-analysis");
    expect(unsupported.message).toContain("no-such-analysis");
    expect(unsupported.message).not.toContain("not available on the worker");
  }, 30_000);

  it("forwards one frame progress beat per visited frame on the shape path", async () => {
    // Same contract as the rdf case above, on the dispatch path: one beat per
    // frame, and the beat carries the *source* frame index, so a sparse range
    // stays addressable in the caller's own numbering.
    const beats: Array<{
      completed: number;
      total: number;
      frameIndex: number;
    }> = [];

    const result = await runAnalysisJob(
      {
        analysisId: CLUSTER_ID,
        params: { cutoff: LATTICE_CUTOFF, minClusterSize: 1 },
        frames: [latticeSnapshot(2), latticeSnapshot(5)],
      },
      (progress) => {
        if (progress.kind !== "frame") return;
        beats.push({
          completed: progress.completed,
          total: progress.total,
          frameIndex: progress.frameIndex,
        });
      },
    );

    expect(beats).toEqual([
      { completed: 1, total: 2, frameIndex: 2 },
      { completed: 2, total: 2, frameIndex: 5 },
    ]);
    expect(result.framesVisited).toEqual([2, 5]);
  }, 60_000);
});
