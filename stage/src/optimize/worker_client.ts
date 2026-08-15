/**
 * Main-thread optimize adapter for the shared compute worker.
 *
 * Owns the optimize-specific envelope — payload wrapping, progress
 * unwrapping, the boot heartbeat. Generic worker lifecycle stays in
 * `../compute/runtime`; dependency flows optimize → compute only.
 */

import type { ComputeJob } from "../compute/protocol";
import { awaitComputeHostReady, getComputeRuntime } from "../compute/runtime";
import type {
  OptimizeCoordsProgress,
  OptimizeJobPayload,
  OptimizeJobResult,
  OptimizeProgress,
  OptimizeStatusWire,
} from "./protocol";
import { optimizeJobTransferList } from "./protocol";

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
   * One beat per reported minimizer step carrying that step's coordinates
   * (Å) — the live-canvas feed, paired with every {@link onStep} beat.
   *
   * The buffer is this thread's own copy (structured-cloned across the worker
   * boundary), so it is safe to read after the callback returns. Omit this to
   * run without a mid-run canvas update; the beats are then dropped.
   */
  onCoords?: (beat: OptimizeCoordsProgress) => void;
  /**
   * Polled by the workload host from the moment the job is posted until it
   * settles — while it waits its turn in the worker's queue as well as while it
   * runs.
   *
   * The first `true` posts one cancel; the worker stops at its next checkpoint
   * and still answers with a result, so this call **resolves** with the last
   * coordinates and `cancelled: true` rather than rejecting.
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
  } else if (p.kind === "coords") {
    // Geometry only: the scalar beat for this same step arrives as its own
    // `kind: "step"` message, so forwarding here too would double-count the
    // panel's progress.
    callbacks.onCoords?.(p);
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
 * **One worker, one job at a time.** Optimize shares the compute worker with the
 * analysis jobs, and the worker runs whatever it is sent first-in-first-out: a
 * job posted while another one is running is queued, and this promise stays
 * pending until its turn comes and it finishes.
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
  await awaitComputeHostReady(host, beat);

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
