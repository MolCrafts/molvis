/**
 * Compute worker lifecycle (spawn / warm / test injection). Domain jobs
 * do not live here.
 *
 * Three layers — do not mix them:
 *
 * 1. **Wire** — plain snapshots, no molrs, no DOM.
 *    `./protocol`, `../analysis/worker_protocol`, `../optimize/protocol`.
 * 2. **Main thread** — UI, pipeline, `postMessage`.
 *    `../analysis/worker_client`, `../optimize/structure` + `worker_client`,
 *    `../optimize/assess` (preflight the panel can run without L-BFGS).
 * 3. **Worker kernels** — no Babylon, no pipeline modifier classes.
 *    The analysis kernel set is the Kernel row of `../analysis/index.ts`'s
 *    layer table (the one authoritative list); optimize side is
 *    `../optimize/{relax,job_runner}`. The worker entry imports these
 *    directly; the public stage barrel must not re-export them.
 *
 * Shared geometry (`../algo/neighbor_list`, `../algo/perceive_bonds`,
 * `../analysis/rdf_params`) is used by both pipeline and kernels. It is
 * small on purpose — do not invent a grab-bag chunk to "dedupe" it.
 *
 * Lazy: {@link warmComputeWorker} when the user opens Optimize / Compute.
 * Jobs run FIFO on one WASM heap.
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
