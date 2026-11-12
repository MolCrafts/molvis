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

interface FakeHandle {
  toJSON(): unknown;
  free(): void;
  frees: number;
  radiusOfGyration?: () => Float64Array;
}

function handle(json: unknown, extra: Partial<FakeHandle> = {}): FakeHandle {
  const fake: FakeHandle = {
    frees: 0,
    toJSON: () => json,
    free() {
      fake.frees += 1;
    },
    ...extra,
  };
  return fake;
}

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
