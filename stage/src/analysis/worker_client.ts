/**
 * Main-thread analysis adapter for the shared compute worker.
 *
 * Owns the analysis-specific envelope — payload wrapping, progress unwrapping,
 * the boot wait. Generic worker lifecycle stays in `../compute/runtime`;
 * dependency flows analysis → compute only.
 */

import type { ComputeJob } from "../compute/protocol";
import { awaitComputeHostReady, getComputeRuntime } from "../compute/runtime";
import type {
  AnalysisJobPayload,
  AnalysisJobProgress,
  AnalysisJobResult,
} from "./worker_protocol";
import { analysisJobTransferList } from "./worker_protocol";

/** UI hooks for one {@link runAnalysisOnWorker} call. */
export interface AnalysisOnWorkerCallbacks {
  /**
   * Progress for this job: a `status` line only while a cold worker is still
   * booting, then one `frame` beat per frame the analysis gets through.
   *
   * Not strictly once per frame: the worker re-posts its last progress payload
   * every few seconds so a long silent stretch cannot read as a stall, so treat
   * a beat as "state now", not as an increment.
   */
  onProgress?: (progress: AnalysisJobProgress) => void;
  /**
   * Polled by the workload host from the moment the job is posted until it
   * settles — while it waits its turn in the worker's queue as well as while it
   * runs.
   *
   * The first `true` posts one cancel; the worker stops at its next frame
   * checkpoint (or skips the work entirely if it had not started), and still
   * answers with a result, so this call **resolves** with `cancelled: true`
   * rather than rejecting.
   */
  shouldCancel?: () => boolean;
}

/**
 * Run one analysis job on the shared compute worker and resolve with its
 * result.
 *
 * Waits for the worker (warming it if this is the first job) while beating
 * `onProgress` so a slow first boot never looks frozen, wraps the payload in the
 * `{ kind: "analysis" }` compute envelope, and unwraps progress back into
 * {@link AnalysisOnWorkerCallbacks}.
 *
 * **The payload's typed arrays are transferred, not copied** — every frame's
 * `x`, `y`, `z` and its optional `ids` / `boxLengths` / `boxOrigin` / `boxTilts`
 * buffers are detached on this thread the moment the job is posted, so reading
 * them afterwards yields a zero-length array. Build the payload for this call
 * only, and read results off the returned envelope rather than off the payload
 * you passed in.
 *
 * **One worker, one job at a time.** Optimize and analysis share a single
 * compute worker, which runs whatever it is sent first-in-first-out: a job
 * posted while an optimize (or another analysis) job is running is queued and
 * this promise stays pending until its turn comes and it finishes. Cancelling
 * meanwhile is still honoured — a cancel that lands on a queued job is
 * remembered, and the job resolves `cancelled` without doing the work.
 *
 * A cancelled job resolves normally: `result.cancelled` is `true`, its payload
 * is `null`, and `framesVisited` says how far the run got.
 *
 * @param payload the analysis, its params, and the frame snapshots to visit
 * @param callbacks progress and cancel-polling hooks; omit for a fire-and-wait
 *   run with no UI feedback
 * @returns the worker's analysis result envelope
 * @throws Error if the worker does not boot within 30 s (bad worker chunk or
 *   URL), if the worker or its job fails (the worker's message is re-thrown),
 *   or if the compute envelope comes back with a non-analysis `kind`
 */
export async function runAnalysisOnWorker(
  payload: AnalysisJobPayload,
  callbacks: AnalysisOnWorkerCallbacks = {},
): Promise<AnalysisJobResult> {
  const host = getComputeRuntime();

  // Boot lines only: no status beat is emitted up front, so a warm worker
  // reports nothing but the analysis' own frame beats.
  await awaitComputeHostReady(host, (message) => {
    callbacks.onProgress?.({ kind: "status", message });
  });

  const wrapped = await host.run(
    { kind: "analysis", payload } satisfies ComputeJob,
    {
      transfer: analysisJobTransferList(payload),
      shouldCancel: callbacks.shouldCancel,
      onProgress: (cp) => {
        if (cp.kind === "analysis") callbacks.onProgress?.(cp.progress);
      },
    },
  );

  if (wrapped.kind !== "analysis") {
    throw new Error(`Unexpected compute result kind: ${wrapped.kind}`);
  }
  return wrapped.result;
}
