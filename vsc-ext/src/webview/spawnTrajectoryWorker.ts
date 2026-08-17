/**
 * VS Code webview replacement for stage's `spawnTrajectoryWorker`.
 *
 * Wired via `NormalModuleReplacementPlugin` in the webview rslib configs so
 * the main-thread graph never pulls the trajectory worker into splitChunks
 * (dual chunk ownership). The worker is a separate rslib entry
 * (`rslib.webview.worker.config.mts` → `out/chunks/worker.js`), colocated
 * with `chunks/shared.js`.
 *
 * Types/runtime resolve from `@molcrafts/molvis-stage` package exports → dist.
 */

import type { Format } from "@molcrafts/molvis-stage/trajectory-protocol";
import {
  TrajectoryRuntime,
  type WorkerLike,
} from "@molcrafts/molvis-stage/trajectory-runtime";

export type { Format } from "@molcrafts/molvis-stage/trajectory-protocol";
export {
  CancellationError,
  type IndexProgressCallback,
  type OpenOptions,
  type OpenResult,
  TrajectoryRuntime,
  type WorkerLike,
} from "@molcrafts/molvis-stage/trajectory-runtime";

export function spawnTrajectoryWorker(format: Format): TrajectoryRuntime {
  if (typeof Worker === "undefined") {
    throw new Error("TrajectoryRuntime: Worker is not available");
  }
  // Non-literal path: bundlers must not treat this as a worker entry to fold
  // into the main graph. Resolves relative to this module's chunk URL
  // (`…/chunks/shared.js` → `…/chunks/worker.js`).
  const workerScript = "./worker.js";
  const worker = new Worker(new URL(workerScript, import.meta.url), {
    type: "module",
    name: `trajectory-${format}`,
  });
  return new TrajectoryRuntime(worker as WorkerLike, format);
}
