/**
 * Main-thread optimize adapter for the shared compute worker.
 *
 * Owns the optimize-specific envelope — payload wrapping, progress
 * unwrapping, the boot heartbeat. Generic worker lifecycle stays in
 * `../compute/runtime`; dependency flows optimize → compute only.
 */

import type { ComputeJob } from "../compute/protocol";
import {
  type ComputeWorkloadHost,
  getComputeRuntime,
} from "../compute/runtime";
import type {
  OptimizeJobPayload,
  OptimizeJobResult,
  OptimizeProgress,
  OptimizeStatusWire,
} from "./protocol";
import { optimizeJobTransferList } from "./protocol";

/** Status-line beat while waiting for worker boot, so the UI looks alive. */
const HEARTBEAT_MS = 2_000;
/**
 * Fail fast on a broken worker URL / chunk. Boot includes the molrs WASM
 * fetch (cached after the main bundle loads it), so allow a slow first hit.
 */
const READY_TIMEOUT_MS = 30_000;

/** UI hooks for one {@link runOptimizeOnWorker} call. */
export interface OptimizeOnWorkerCallbacks {
  /**
   * Human-readable phase beats (boot, prepare, bond detection, minimize …)
   * with an optional 0–100 `progress` — status bar / panel line.
   */
  onStatus?: (status: OptimizeStatusWire) => void;
  /**
   * One beat per reported minimizer step (`reportEvery` in the payload
   * throttles them) — progress bar and energy / force readout.
   */
  onStep?: (info: {
    step: number;
    maxSteps: number;
    energy: number;
    maxForce: number;
    converged: boolean;
  }) => void;
  /**
   * Polled by the workload host while the job runs. The first `true` posts one
   * cancel; the worker stops at its next checkpoint and still answers with a
   * result, so this call **resolves** with the last coordinates and
   * `cancelled: true` rather than rejecting.
   */
  shouldCancel?: () => boolean;
}

/** Fan one worker progress message out to the matching callback. */
function handleOptimizeProgress(
  p: OptimizeProgress,
  callbacks: OptimizeOnWorkerCallbacks,
): void {
  if (p.kind === "status") {
    callbacks.onStatus?.({
      phase: p.phase,
      message: p.message,
      progress: p.progress,
      step: p.step,
      maxSteps: p.maxSteps,
    });
  } else if (p.kind === "step") {
    callbacks.onStep?.({
      step: p.step,
      maxSteps: p.maxSteps,
      energy: p.energy,
      maxForce: p.maxForce,
      converged: p.converged,
    });
  }
}

/** Await worker boot; beat the status line so the UI never looks stalled. */
async function waitReady(
  host: ComputeWorkloadHost,
  onWait: (msg: string) => void,
): Promise<void> {
  const hb = setInterval(() => onWait("Starting optimization…"), HEARTBEAT_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      host.whenReady(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              "Compute worker failed to start (check worker URL / chunk). " +
                "See browser console for worker load errors.",
            ),
          );
        }, READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    clearInterval(hb);
  }
}

/**
 * Run one optimize job on the shared compute worker and resolve with its
 * result.
 *
 * Waits for the worker (warming it if this is the first job) while beating
 * `onStatus` so a slow first boot never looks frozen, wraps the payload in the
 * `{ kind: "optimize" }` compute envelope, and unwraps progress back into
 * {@link OptimizeOnWorkerCallbacks}.
 *
 * **The job's typed arrays are transferred, not copied** — `job.x`, `job.y`,
 * `job.z`, `bondI`, `bondJ`, `fixedIndices` and the optional `bondType` /
 * `boxLengths` / `boxOrigin` buffers are detached on this thread once the job
 * is posted. Build the payload for this call only, and read coordinates back
 * from the result rather than from the payload you passed in.
 *
 * A cancelled job resolves normally: `result.cancelled` is `true` and
 * `result.x/y/z` hold the last coordinates the optimizer reached, which the
 * caller is expected to publish.
 *
 * @param job plain (handle-free) working structure plus optimizer settings
 * @returns the worker's optimize result — coordinates, topology, energetics
 * @throws Error if the worker does not boot within 30 s (bad worker chunk or
 *   URL), if the worker or its job fails (the worker's message is re-thrown),
 *   or if the compute envelope comes back with a non-optimize `kind`
 */
export async function runOptimizeOnWorker(
  job: OptimizeJobPayload,
  callbacks: OptimizeOnWorkerCallbacks = {},
): Promise<OptimizeJobResult> {
  const host = getComputeRuntime();

  const beat = (line: string) => {
    callbacks.onStatus?.({ phase: "pipeline", message: line });
  };
  beat("Starting optimization…");
  await waitReady(host, beat);

  const wrapped = await host.run(
    { kind: "optimize", payload: job } satisfies ComputeJob,
    {
      transfer: optimizeJobTransferList(job),
      shouldCancel: callbacks.shouldCancel,
      onProgress: (cp) => {
        if (cp.kind === "optimize") {
          handleOptimizeProgress(cp.progress, callbacks);
        }
      },
    },
  );

  if (wrapped.kind !== "optimize") {
    throw new Error(`Unexpected compute result kind: ${wrapped.kind}`);
  }
  return wrapped.result;
}
