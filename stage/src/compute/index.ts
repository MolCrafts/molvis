/**
 * Shared compute worker — one Dedicated Worker (a background thread with its own
 * module graph and its own WebAssembly instance) for every heavy stage job:
 * structure optimize and the worker-backed analyses — RDF (radial distribution
 * function) and MSD (mean squared displacement).
 *
 * Lazy: {@link warmComputeWorker} when the user opens Optimize / Compute. The
 * worker runs jobs first-in-first-out, one at a time, so the two domains queue
 * behind each other rather than competing for one WebAssembly heap.
 *
 * This module owns only the generic worker lifecycle (spawn, warm, test
 * injection) and the job-kind discriminator. Nothing domain-specific lives here:
 * payload/progress mapping and the `runOptimizeOnWorker` /
 * `runAnalysisOnWorker` entry points belong to `../optimize/worker_client` and
 * `../analysis/worker_client`, which depend on this module and never the other
 * way around.
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
