import { describe, expect, it } from "@rstest/core";
import {
  CLUSTER_ANALYSIS_ID,
  COM_ANALYSIS_ID,
  MSD_ANALYSIS_ID,
  RDF_ANALYSIS_ID,
  VORONOI_RADICAL_ANALYSIS_ID,
} from "../../src/analysis/analysis_ids";
import {
  ANALYSIS_RESULT_MARSHALLERS,
  marshalAnalysisResult,
} from "../../src/analysis/result_marshal";
import { AnalysisUnsupportedError } from "../../src/analysis/trajectory_runner";

/**
 * `result_marshal.ts` owns one thing: the *shape* a molrs result handle takes
 * on the way out of an analysis run — copy the columns, free the handle, hand
 * back inert plain data. Nothing it does needs WASM, a `Frame`, or a
 * trajectory, so every handle below is a hand-written plain object with the
 * getters that entry reads plus a `free()` counter.
 *
 * Deliberately **no** `@molcrafts/molvis-core/molrs` import and **no**
 * `../setup_wasm` import: this is the one test in `tests/analysis/` that must
 * stay WASM-free, which is the executable proof that the marshalling table is
 * decoupled from the bindings it serializes.
 *
 * Every expectation is a hard-coded golden. The field names, field set and
 * `free()` timing are transcribed from the branches this table replaces —
 * `dispatch.normalizeResult` (rdf, cluster), `dispatch.centersOfMassPayload`
 * (com) and the msd branch of `dispatch.runAccumulate` — so a mismatch here
 * means the move was not payload-equivalent.
 */

// ---------------------------------------------------------------------------
// Fake result handles — plain objects, molrs-shaped, no WASM
// ---------------------------------------------------------------------------

/** Mirrors `molrs.RDFResult`: four column getters plus three scalar getters. */
class FakeRdfResult {
  freeCalls = 0;
  readonly numPoints = 2;
  readonly rMin = 0;
  readonly volume = 8000;

  binCenters(): Float64Array {
    return Float64Array.from([0.5, 1.5]);
  }

  binEdges(): Float64Array {
    return Float64Array.from([0, 1, 2]);
  }

  rdf(): Float64Array {
    return Float64Array.from([0.25, 1.75]);
  }

  pairCounts(): Float64Array {
    return Float64Array.from([3, 11]);
  }

  free(): void {
    this.freeCalls += 1;
  }
}

/** Mirrors `molrs.ClusterResult`: `Uint32Array` sizes, `Int32Array` indices. */
class FakeClusterResult {
  freeCalls = 0;
  readonly numClusters = 2;

  clusterSizes(): Uint32Array {
    return Uint32Array.from([3, 1]);
  }

  clusterIdx(): Int32Array {
    return Int32Array.from([0, 0, 0, 1, -1]);
  }

  free(): void {
    this.freeCalls += 1;
  }
}

/** Mirrors `molrs.CenterOfMassResult`: flat `[x,y,z, …]` plus masses. */
class FakeCenterOfMassResult {
  freeCalls = 0;
  readonly numClusters = 2;

  centersOfMass(): Float64Array {
    return Float64Array.from([1, 2, 3, 4, 5, 6]);
  }

  clusterMasses(): Float64Array {
    return Float64Array.from([12, 16]);
  }

  free(): void {
    this.freeCalls += 1;
  }
}

/** Mirrors `molrs.MSDResult`: one handle per accumulated lag. */
class FakeMsdResult {
  freeCalls = 0;

  constructor(
    readonly mean: number,
    private readonly perParticleValues: readonly number[],
  ) {}

  perParticle(): Float64Array {
    return Float64Array.from(this.perParticleValues);
  }

  free(): void {
    this.freeCalls += 1;
  }
}

/**
 * An unlisted id's payload: already plain data on arrival. Every member logs,
 * so "the table did not touch it" is an assertion rather than a hope.
 */
class SentinelPayload {
  readonly calls: string[] = [];

  free(): void {
    this.calls.push("free");
  }

  compute(): void {
    this.calls.push("compute");
  }

  toJSON(): void {
    this.calls.push("toJSON");
  }
}

// ---------------------------------------------------------------------------
// Payload shapes — the plain-data contract each entry must produce
// ---------------------------------------------------------------------------

interface RdfPayload {
  binCenters: Float64Array;
  binEdges: Float64Array;
  rdf: Float64Array;
  pairCounts: Float64Array;
  numPoints: number;
  rMin: number;
  volume: number;
}

interface ClusterPayload {
  clusterSizes: Uint32Array;
  clusterIdx: Int32Array;
  numClusters: number;
}

interface CenterOfMassPayload {
  centersOfMass: Float64Array;
  clusterMasses: Float64Array;
  numClusters: number;
}

interface MsdEntryPayload {
  mean: number;
  perParticle: Float64Array;
}

/** Catch without `try` noise; returns whatever `run` threw. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("TestResultMarshal", () => {
  it("lists exactly the four owned-result ids", () => {
    // Hard-coded closed set: a fifth entry means an id was added without the
    // default-passthrough argument being re-examined.
    expect(Object.keys(ANALYSIS_RESULT_MARSHALLERS).sort()).toEqual(
      [
        CLUSTER_ANALYSIS_ID,
        COM_ANALYSIS_ID,
        MSD_ANALYSIS_ID,
        RDF_ANALYSIS_ID,
      ].sort(),
    );
  });

  it("copies every rdf column and frees the handle once", () => {
    const handle = new FakeRdfResult();

    const payload = marshalAnalysisResult(
      RDF_ANALYSIS_ID,
      handle,
    ) as RdfPayload;

    expect(Array.from(payload.binCenters)).toEqual([0.5, 1.5]);
    expect(Array.from(payload.binEdges)).toEqual([0, 1, 2]);
    expect(Array.from(payload.rdf)).toEqual([0.25, 1.75]);
    expect(Array.from(payload.pairCounts)).toEqual([3, 11]);
    expect(payload.numPoints).toBe(2);
    expect(payload.rMin).toBe(0);
    expect(payload.volume).toBe(8000);
    // Field set is part of the contract: no extra keys, none dropped.
    expect(Object.keys(payload).sort()).toEqual([
      "binCenters",
      "binEdges",
      "numPoints",
      "pairCounts",
      "rMin",
      "rdf",
      "volume",
    ]);
    expect(handle.freeCalls).toBe(1);
  });

  it("copies every cluster column and frees the handle once", () => {
    const handle = new FakeClusterResult();

    const payload = marshalAnalysisResult(
      CLUSTER_ANALYSIS_ID,
      handle,
    ) as ClusterPayload;

    expect(Array.from(payload.clusterSizes)).toEqual([3, 1]);
    expect(Array.from(payload.clusterIdx)).toEqual([0, 0, 0, 1, -1]);
    expect(payload.numClusters).toBe(2);
    expect(Object.keys(payload).sort()).toEqual([
      "clusterIdx",
      "clusterSizes",
      "numClusters",
    ]);
    expect(handle.freeCalls).toBe(1);
  });

  it("copies every centre-of-mass column and frees the handle once", () => {
    const handle = new FakeCenterOfMassResult();

    const payload = marshalAnalysisResult(
      COM_ANALYSIS_ID,
      handle,
    ) as CenterOfMassPayload;

    expect(Array.from(payload.centersOfMass)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(payload.clusterMasses)).toEqual([12, 16]);
    expect(payload.numClusters).toBe(2);
    expect(Object.keys(payload).sort()).toEqual([
      "centersOfMass",
      "clusterMasses",
      "numClusters",
    ]);
    expect(handle.freeCalls).toBe(1);
  });

  it("maps the msd handle array in order and frees every handle once", () => {
    const first = new FakeMsdResult(0.5, [0.4, 0.6]);
    const second = new FakeMsdResult(2.5, [2, 3]);

    const payload = marshalAnalysisResult(MSD_ANALYSIS_ID, [
      first,
      second,
    ]) as MsdEntryPayload[];

    expect(payload).toHaveLength(2);
    expect(payload[0].mean).toBe(0.5);
    expect(Array.from(payload[0].perParticle)).toEqual([0.4, 0.6]);
    expect(payload[1].mean).toBe(2.5);
    expect(Array.from(payload[1].perParticle)).toEqual([2, 3]);
    expect(Object.keys(payload[0]).sort()).toEqual(["mean", "perParticle"]);
    expect(first.freeCalls).toBe(1);
    expect(second.freeCalls).toBe(1);
  });

  it("passes an unlisted id's payload through by reference, untouched", () => {
    // Executable evidence that adding a catalog analysis needs no edit here.
    const sentinel = new SentinelPayload();

    const payload = marshalAnalysisResult(
      VORONOI_RADICAL_ANALYSIS_ID,
      sentinel,
    );

    expect(payload).toBe(sentinel);
    expect(sentinel.calls).toEqual([]);
  });

  it("rejects an undefined result handle as AnalysisUnsupportedError", () => {
    const error = thrownBy(() =>
      marshalAnalysisResult(RDF_ANALYSIS_ID, undefined),
    );

    expect(error).toBeInstanceOf(AnalysisUnsupportedError);
    const unsupported = error as AnalysisUnsupportedError;
    expect(unsupported.name).toBe("AnalysisUnsupportedError");
    expect(unsupported.analysisId).toBe(RDF_ANALYSIS_ID);
  });

  it("rejects a non-object result handle as AnalysisUnsupportedError", () => {
    const error = thrownBy(() =>
      marshalAnalysisResult(CLUSTER_ANALYSIS_ID, 42),
    );

    expect(error).toBeInstanceOf(AnalysisUnsupportedError);
    const unsupported = error as AnalysisUnsupportedError;
    expect(unsupported.name).toBe("AnalysisUnsupportedError");
    expect(unsupported.analysisId).toBe(CLUSTER_ANALYSIS_ID);
  });

  it("rejects a null result handle as AnalysisUnsupportedError", () => {
    // `typeof null === "object"` — the guard must not be a bare typeof check.
    const error = thrownBy(() => marshalAnalysisResult(COM_ANALYSIS_ID, null));

    expect(error).toBeInstanceOf(AnalysisUnsupportedError);
    const unsupported = error as AnalysisUnsupportedError;
    expect(unsupported.name).toBe("AnalysisUnsupportedError");
    expect(unsupported.analysisId).toBe(COM_ANALYSIS_ID);
  });
});
