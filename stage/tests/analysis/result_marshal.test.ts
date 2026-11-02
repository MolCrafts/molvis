import { describe, expect, it } from "@rstest/core";
import {
  CLUSTER_ANALYSIS_ID,
  COM_ANALYSIS_ID,
  RDF_ANALYSIS_ID,
} from "../../src/analysis/analysis_ids";
import { marshalAnalysisResult } from "../../src/analysis/result_marshal";
import { AnalysisUnsupportedError } from "../../src/analysis/trajectory_runner";

/**
 * `result_marshal.ts` owns one thing: the *shape* a molrs result handle takes
 * on the way out of an analysis run — read `toJSON()`, flatten every
 * `{ dim, data }` array, free the handle, hand back inert plain data. Nothing
 * it does needs WASM, so every handle below is a hand-written plain object in
 * the shape molrs 0.18's `toJSON()` writes, plus a `free()` counter.
 *
 * Deliberately **no** `@molcrafts/molvis-core/molrs` import and **no**
 * `../setup_wasm` import: the executable proof that marshalling is decoupled
 * from the bindings it reads.
 */

// ---------------------------------------------------------------------------
// Fake result handles — plain objects, molrs-shaped, no WASM
// ---------------------------------------------------------------------------

/** Mirrors `molrs.RDFResult`: four column getters plus three scalar getters. */
class FakeRdfResult {
  freeCalls = 0;
  readonly nPoints = 2;
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
  readonly nClusters = 2;

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
  readonly nClusters = 2;

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

/** Catch without `try` noise; returns whatever `run` threw. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("marshalAnalysisResult", () => {
  it("flattens every shaped array and keeps its shape", () => {
    const raw = handle({
      bin_centers: { v: 1, dim: [2], data: [0.5, 1.5] },
      rdf: { v: 1, dim: [2], data: [0, 2] },
      n_points: 8,
      volume: 1000,
    });

    const payload = marshalAnalysisResult(RDF_ANALYSIS_ID, raw);

    expect(payload.bin_centers).toEqual(Float64Array.from([0.5, 1.5]));
    expect(payload.rdf).toEqual(Float64Array.from([0, 2]));
    expect(payload.n_points).toBe(8);
    expect(payload.volume).toBe(1000);
    expect(payload.shapes).toEqual({ bin_centers: [2], rdf: [2] });
    expect(payload.shape).toBeUndefined();
    expect(raw.frees).toBe(1);
  });

  it("names the first multi-dimensional field as the payload shape", () => {
    const payload = marshalAnalysisResult(
      COM_ANALYSIS_ID,
      handle({
        groups: [0, 1],
        centers: { v: 1, dim: [2, 3], data: [0, 0, 0, 1, 1, 1] },
        total_masses: { v: 1, dim: [2], data: [12, 24] },
      }),
    );
    expect(payload.shape).toEqual([2, 3]);
    expect(payload.groups).toEqual([0, 1]);
  });

  it("adds the radius of gyration a gyration result derives", () => {
    const payload = marshalAnalysisResult(
      COM_ANALYSIS_ID,
      handle(
        { groups: [0] },
        { radiusOfGyration: () => Float64Array.from([1.25]) },
      ),
    );
    expect(payload.radius_of_gyration).toEqual(Float64Array.from([1.25]));
  });

  it("frees the handle even when reading it throws", () => {
    const raw = handle(undefined, {
      toJSON: () => {
        throw new Error("boom");
      },
    });
    expect(() => marshalAnalysisResult(CLUSTER_ANALYSIS_ID, raw)).toThrow(
      "boom",
    );
    expect(raw.frees).toBe(1);
  });

  for (const [label, raw] of [
    ["undefined", undefined],
    ["a number", 42],
    ["null", null],
    ["a plain object", { values: [1] }],
  ] as const) {
    it(`rejects ${label} as AnalysisUnsupportedError`, () => {
      const error = thrownBy(() =>
        marshalAnalysisResult(CLUSTER_ANALYSIS_ID, raw),
      );
      expect(error).toBeInstanceOf(AnalysisUnsupportedError);
      expect((error as AnalysisUnsupportedError).analysisId).toBe(
        CLUSTER_ANALYSIS_ID,
      );
    });
  }
});
