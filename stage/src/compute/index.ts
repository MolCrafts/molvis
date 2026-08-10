/**
 * Shared compute worker — one Dedicated Worker for optimize (and later analysis).
 *
 * Lazy: {@link warmComputeWorker} when the user opens Optimize / Compute.
 *
 * This module owns only the generic worker lifecycle (spawn, warm, test
 * injection) and the job-kind discriminator. Nothing optimize-specific lives
 * here: the payload/progress mapping and the `runOptimizeOnWorker` entry point
 * belong to `../optimize/worker_client`, which depends on this module and
 * never the other way around.
 */

export type {
  ComputeJob,
  ComputeProgress,
  ComputeResult,
} from "./protocol";
export {
  type ComputeWorkloadHost,
  getComputeRuntime,
  setComputeRuntimeForTests,
  warmComputeWorker,
} from "./runtime";
export { spawnComputeWorker } from "./spawn";
