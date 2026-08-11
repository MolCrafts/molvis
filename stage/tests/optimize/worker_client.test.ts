import { afterEach, describe, expect, it } from "@rstest/core";
import type {
  ComputeProgress,
  ComputeResult,
} from "../../src/compute/protocol";
import { setComputeRuntimeForTests } from "../../src/compute/runtime";
import type {
  OptimizeJobPayload,
  OptimizeJobResult,
} from "../../src/optimize/protocol";
import { runOptimizeOnWorker } from "../../src/optimize/worker_client";
import {
  type ComputeJobScript,
  installScriptedComputeHost,
  type ScriptedComputeWorker,
} from "../workload_test_helpers";

/** Install a real `WorkloadHost` driven by the scripted fake worker. */
function installHost(script: ComputeJobScript): ScriptedComputeWorker {
  return installScriptedComputeHost(script, { cancelPollMs: 5 });
}

/** Water dimer-ish stub: plain typed arrays, no molrs handles. */
function waterJob(): OptimizeJobPayload {
  return {
    x: new Float64Array([0, 0.96, -0.24]),
    y: new Float64Array([0, 0, 0.93]),
    z: new Float64Array([0, 0, 0]),
    elements: ["O", "H", "H"],
    bondI: new Uint32Array([0, 0]),
    bondJ: new Uint32Array([1, 2]),
    potential: "uff",
    optimizer: "lbfgs",
    maxSteps: 20,
    forceTol: 0.05,
    fixedIndices: new Uint32Array(0),
    ensureBonds: false,
    addHydrogens: false,
    reportEvery: 1,
  };
}

function optimizeResult(cancelled: boolean): OptimizeJobResult {
  return {
    x: new Float64Array([0, 0.97, -0.25]),
    y: new Float64Array([0, 0, 0.94]),
    z: new Float64Array([0, 0, 0]),
    steps: 7,
    energy: -12.5,
    maxForce: 0.02,
    converged: !cancelled,
    cancelled,
    atomCount: 3,
    hydrogensAdded: 0,
    potential: "uff",
    optimizer: "lbfgs",
  };
}

describe("optimize worker client", () => {
  afterEach(() => {
    // Disposes the injected host (terminate → fake clears its timers).
    setComputeRuntimeForTests(null);
  });

  it("streams status and step progress before resolving the result", async () => {
    installHost(({ id, emit }) => {
      emit({
        type: "progress",
        id,
        progress: {
          kind: "optimize",
          progress: {
            kind: "status",
            phase: "minimize",
            message: "Minimizing…",
            progress: 50,
            step: 3,
            maxSteps: 20,
          },
        } satisfies ComputeProgress,
      });
      emit({
        type: "progress",
        id,
        progress: {
          kind: "optimize",
          progress: {
            kind: "step",
            step: 3,
            maxSteps: 20,
            energy: -11.25,
            maxForce: 0.31,
            converged: false,
          },
        } satisfies ComputeProgress,
      });
      emit({
        type: "done",
        id,
        result: {
          kind: "optimize",
          result: optimizeResult(false),
        } satisfies ComputeResult,
      });
    });

    const order: string[] = [];
    const result = await runOptimizeOnWorker(waterJob(), {
      onStatus: (s) => order.push(`status:${s.phase}`),
      onStep: (s) => order.push(`step:${s.step}`),
    });
    order.push("resolved");

    // "Starting optimization…" beat is a pipeline status before the worker beats.
    expect(order).toEqual([
      "status:pipeline",
      "status:minimize",
      "step:3",
      "resolved",
    ]);
    expect(result.steps).toBe(7);
    expect(result.energy).toBeCloseTo(-12.5, 10);
    expect(result.maxForce).toBeCloseTo(0.02, 8);
    expect(result.converged).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.atomCount).toBe(3);
    expect(result.hydrogensAdded).toBe(0);
    expect(result.potential).toBe("uff");
    expect(result.optimizer).toBe("lbfgs");
    expect(Array.from(result.x)).toEqual([0, 0.97, -0.25]);
    expect(Array.from(result.y)).toEqual([0, 0, 0.94]);
    expect(Array.from(result.z)).toEqual([0, 0, 0]);
  });

  it("cancels a mid-run job and resolves with the cancelled result", async () => {
    const fake = installHost(({ id, emit, every, onCancel }) => {
      let step = 0;
      every(5, () => {
        step++;
        emit({
          type: "progress",
          id,
          progress: {
            kind: "optimize",
            progress: {
              kind: "step",
              step,
              maxSteps: 20,
              energy: -10,
              maxForce: 0.5,
              converged: false,
            },
          } satisfies ComputeProgress,
        });
      });
      onCancel(() => {
        emit({
          type: "done",
          id,
          result: {
            kind: "optimize",
            result: optimizeResult(true),
          } satisfies ComputeResult,
        });
      });
    });

    let steps = 0;
    const result = await runOptimizeOnWorker(waterJob(), {
      onStep: () => {
        steps++;
      },
      shouldCancel: () => steps >= 1,
    });

    expect(steps).toBeGreaterThanOrEqual(1);
    expect(result.cancelled).toBe(true);
    expect(result.converged).toBe(false);
    expect(fake.cancelledIds).toEqual([1]);
  });

  it("rejects when the done envelope carries a foreign result kind", async () => {
    installHost(({ id, emit }) => {
      emit({
        type: "done",
        id,
        result: { kind: "analysis", result: null },
      });
    });

    await expect(runOptimizeOnWorker(waterJob())).rejects.toThrow(
      "Unexpected compute result kind: analysis",
    );
  });
});
