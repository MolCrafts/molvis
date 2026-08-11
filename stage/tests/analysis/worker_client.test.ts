import { afterEach, describe, expect, it } from "@rstest/core";
import { runAnalysisOnWorker } from "../../src/analysis/worker_client";
import type {
  AnalysisJobPayload,
  AnalysisJobResult,
} from "../../src/analysis/worker_protocol";
import type {
  ComputeProgress,
  ComputeResult,
} from "../../src/compute/protocol";
import { setComputeRuntimeForTests } from "../../src/compute/runtime";
import { installScriptedComputeHost } from "../workload_test_helpers";

/** Catalog key of the analysis (see `job_runner.test.ts` for why it is the long id). */
const RDF_ID = "rdf.radial_distribution";

/** Two-atom periodic snapshot: plain typed arrays, no molrs handles. */
function rdfJob(): AnalysisJobPayload {
  return {
    analysisId: RDF_ID,
    params: { rMax: 5, nBins: 50, rMin: 0 },
    frames: [
      {
        frameIndex: 0,
        x: new Float64Array([0, 1.05]),
        y: new Float64Array([0, 0]),
        z: new Float64Array([0, 0]),
        elements: ["Ar", "Ar"],
        boxLengths: new Float64Array([20, 20, 20]),
        boxOrigin: new Float64Array([0, 0, 0]),
      },
      {
        frameIndex: 1,
        x: new Float64Array([0, 2.05]),
        y: new Float64Array([0, 0]),
        z: new Float64Array([0, 0]),
        elements: ["Ar", "Ar"],
        boxLengths: new Float64Array([20, 20, 20]),
        boxOrigin: new Float64Array([0, 0, 0]),
      },
    ],
  };
}

/**
 * Opaque analysis result. `payload` is deliberately a marker object, not a real
 * RDF series: this file tests the envelope, not the computation.
 */
function analysisResult(cancelled: boolean): AnalysisJobResult {
  return {
    analysisId: RDF_ID,
    cancelled,
    payload: cancelled ? null : { marker: 42 },
    framesVisited: cancelled ? [0] : [0, 1],
  };
}

describe("analysis worker client", () => {
  afterEach(() => {
    // Disposes the injected host (terminate → fake clears its timers).
    setComputeRuntimeForTests(null);
  });

  it("streams frame progress before resolving the result", async () => {
    installScriptedComputeHost(({ id, emit }) => {
      emit({
        type: "progress",
        id,
        progress: {
          kind: "analysis",
          progress: { kind: "frame", completed: 1, total: 2, frameIndex: 0 },
        } satisfies ComputeProgress,
      });
      emit({
        type: "done",
        id,
        result: {
          kind: "analysis",
          result: analysisResult(false),
        } satisfies ComputeResult,
      });
    });

    const order: string[] = [];
    const result = await runAnalysisOnWorker(rdfJob(), {
      onProgress: (p) => {
        order.push(
          p.kind === "frame"
            ? `frame:${p.completed}/${p.total}:${p.frameIndex}`
            : `status:${p.message}`,
        );
      },
    });
    order.push("resolved");

    expect(order).toEqual(["frame:1/2:0", "resolved"]);
    expect(result.analysisId).toBe(RDF_ID);
    expect(result.cancelled).toBe(false);
    expect(result.framesVisited).toEqual([0, 1]);
    // The payload crosses the envelope untouched.
    expect(result.payload).toEqual({ marker: 42 });
  });

  it("cancels a mid-run job and resolves the worker's cancelled result", async () => {
    const fake = installScriptedComputeHost(
      ({ id, emit, every, onCancel }) => {
        let completed = 0;
        every(5, () => {
          completed++;
          emit({
            type: "progress",
            id,
            progress: {
              kind: "analysis",
              progress: {
                kind: "frame",
                completed,
                total: 2,
                frameIndex: completed - 1,
              },
            } satisfies ComputeProgress,
          });
        });
        onCancel(() => {
          emit({
            type: "done",
            id,
            result: {
              kind: "analysis",
              result: analysisResult(true),
            } satisfies ComputeResult,
          });
        });
      },
      { cancelPollMs: 5 },
    );

    let beats = 0;
    const result = await runAnalysisOnWorker(rdfJob(), {
      onProgress: () => {
        beats++;
      },
      shouldCancel: () => beats >= 1,
    });

    expect(beats).toBeGreaterThanOrEqual(1);
    // A cancelled job answers `done`, so this resolves rather than rejecting.
    expect(result.cancelled).toBe(true);
    expect(result.payload).toBe(null);
    expect(result.framesVisited).toEqual([0]);
    expect(fake.cancelledIds).toEqual([1]);
  });

  it("rejects when the done envelope carries a foreign result kind", async () => {
    installScriptedComputeHost(({ id, emit }) => {
      emit({
        type: "done",
        id,
        result: { kind: "optimize", result: null },
      });
    });

    await expect(runAnalysisOnWorker(rdfJob())).rejects.toThrow(/optimize/);
  });
});
