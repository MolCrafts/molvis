/// <reference lib="webworker" />
/**
 * Single compute Dedicated Worker for stage heavy work.
 *
 * Domain imports are static: the worker itself is only spawned on demand
 * (panel open / first job), so `installComputeWorker` posting `ready` after
 * the optimize + analysis graphs and molrs WASM are live makes
 * `warmComputeWorker()` a real warm-up — the first job then starts immediately.
 *
 * Loaded via `./spawn` (`new Worker(new URL("./worker.js", …))`) or as the
 * package export `@molcrafts/molvis-stage/compute-worker` for hosts that build
 * the worker separately (VS Code webview).
 */

import { installWorkloadHandler } from "@molcrafts/molvis-core/workload";
import { runAnalysisJob } from "../analysis/job_runner";
import { runOptimizeJob } from "../optimize/job_runner";
import { optimizeResultTransferList } from "../optimize/protocol";
import type { ComputeJob, ComputeProgress, ComputeResult } from "./protocol";

let installed = false;

/**
 * Install the run/cancel/ready loop on the current Dedicated Worker and answer
 * `ready`, then dispatch each job to its domain runner by `kind`.
 *
 * Importing this module already calls it (bottom of the file), which is what
 * makes the module usable as a worker entry point; the export exists for a host
 * that imports the module for its side effects in some other order. Idempotent —
 * a second call is a no-op, so the handler installed first keeps the scope.
 *
 * Jobs are queued and run one at a time by the workload layer
 * (`installWorkloadHandler`), so nothing here needs to guard against two heavy
 * WebAssembly jobs overlapping.
 *
 * @throws Error inside a job (never from this call) when the job carries a
 *   `kind` this worker does not implement; the workload layer reports it to the
 *   host as that job's error
 */
export function installComputeWorker(): void {
  if (installed) return;
  installed = true;

  installWorkloadHandler<ComputeJob, ComputeResult>({
    async run(job, ctx) {
      if (job.kind === "optimize") {
        const result = await runOptimizeJob(
          job.payload,
          (progress) => {
            ctx.reportProgress({
              kind: "optimize",
              progress,
            } satisfies ComputeProgress);
          },
          () => ctx.isCancelled(),
        );

        return {
          result: { kind: "optimize", result },
          transfer: optimizeResultTransferList(result),
        };
      }

      if (job.kind === "analysis") {
        const result = await runAnalysisJob(
          job.payload,
          (progress) => {
            ctx.reportProgress({
              kind: "analysis",
              progress,
            } satisfies ComputeProgress);
          },
          () => ctx.isCancelled(),
        );

        // No transfer list, by design: `AnalysisJobResult.payload` is `unknown`
        // — its shape belongs to the analysis, not to this envelope. Walking it
        // for buffers would mean guessing, and a wrong guess is worse than a
        // copy: handing `postMessage` a view into WASM memory, or a buffer the
        // analysis still holds, turns a finished job into a DataCloneError. So
        // the payload is structured-cloned, i.e. copied once (RDF series are
        // `nBins` floats; the MSD series is `nAtoms` floats per frame).
        return { result: { kind: "analysis", result } };
      }

      throw new Error(
        `Unknown compute job kind: ${(job as { kind?: string }).kind ?? "?"}`,
      );
    },
  });
}

// Direct worker entry (spawn.ts URL / package export `compute-worker`).
installComputeWorker();
