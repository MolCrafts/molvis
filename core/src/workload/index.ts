/**
 * Dedicated-worker workload substrate for MolVis.
 *
 * - {@link WorkloadHost} — main-thread client (jobs, cancel, progress)
 * - {@link installWorkloadHandler} — worker-side run loop
 * - {@link WorkloadRequest} / {@link WorkloadResponse} — envelope types
 *
 * Domain packages (stage optimize, analysis, …) own their job
 * payload, worker script, and progress shape. Core owns only the wire
 * and lifecycle so every heavy molrs job can stay off the UI thread.
 */

export type { WorkloadHostOptions, WorkloadRunOptions } from "./host";
export { createWorkloadSingleton, WorkloadHost } from "./host";
export type {
  WorkloadRequest,
  WorkloadResponse,
} from "./protocol";
export { isWorkloadResponse } from "./protocol";

export type {
  WorkloadHandlerOptions,
  WorkloadWorkerContext,
  WorkloadWorkerScope,
} from "./worker_side";
export { installWorkloadHandler } from "./worker_side";
