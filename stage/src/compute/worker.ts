/// <reference lib="webworker" />
/**
 * Single compute Dedicated Worker for stage heavy work.
 *
 * Domain imports are static: the worker itself is only spawned on demand
 * (panel open / first job), so `installComputeWorker` posting `ready` after
 * the optimize graph + molrs WASM are live makes `warmComputeWorker()` a
 * real warm-up — the first job then starts immediately.
 *
 * Loaded via {@link ./spawn} (`new Worker(new URL("./worker.js", …))`) or as
 * the package export `@molcrafts/molvis-stage/compute-worker` for hosts that
 * build the worker separately (VS Code webview).
 */

import { installWorkloadHandler } from "@molcrafts/molvis-core/workload";
import { runOptimizeJob } from "../optimize/job_runner";
import { optimizeResultTransferList } from "../optimize/protocol";
import type { ComputeJob, ComputeProgress, ComputeResult } from "./protocol";

let installed = false;

/** Install the compute workload handler on the current Dedicated Worker (idempotent). */
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

      throw new Error(
        `Unknown compute job kind: ${(job as { kind?: string }).kind ?? "?"}`,
      );
    },
  });
}

// Direct worker entry (spawn.ts URL / package export `compute-worker`).
installComputeWorker();
