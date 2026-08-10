/**
 * Structure optimization: potential × optimizer, run on the shared compute
 * worker.
 *
 * | Module | Role |
 * |--------|------|
 * | `structure.ts` | App entry ({@link runOptimize}) — snapshot the committed scene, post the job, publish the result |
 * | `worker_client.ts` | Main-thread worker adapter ({@link runOptimizeOnWorker}) — payload wrapping, progress fan-out, boot wait |
 * | `protocol.ts` | Job / result / progress shapes crossing the thread boundary, plus their transfer lists |
 * | `job_runner.ts` | Worker-side pipeline ({@link runOptimizeJob}) — bonds, hydrogens, minimize; no Babylon, no DOM |
 * | `relax.ts` | Potential runners ({@link runLbfgsOptimize} / {@link runDampedOptimize}) and the sizing / error helpers |
 *
 * Compose via {@link resolveOptimizePair}: e.g. UFF+lbfgs, soft+damped.
 * The only product entry point is {@link runOptimize} — nothing runs a full
 * relax loop on the main thread.
 */

export { runOptimizeJob } from "./job_runner";
export type {
  OptimizeJobPayload,
  OptimizeJobResult,
  OptimizeProgress,
  OptimizeStatusProgress,
  OptimizeStatusWire,
  OptimizeStepProgress,
} from "./protocol";
export {
  assessFrameForOptimize,
  assessOptimizeAtomTypes,
  assessOptimizeSize,
  classifyOptimizeFailure,
  type DampedOptimizeInput,
  defaultOptimizeReportEvery,
  defaultOptimizer,
  estimateOptimizePeakBytes,
  estimateSoftPairs,
  formatOptimizeError,
  isMolrsPotential,
  isWasmPanic,
  LBFGS_MAX_ATOMS,
  type LbfgsOptimizeInput,
  OPTIMIZE_STALL_MS,
  type OptimizeFailureClass,
  type OptimizePair,
  type OptimizePhase,
  type OptimizeResourceProbe,
  type OptimizeResult,
  type OptimizerKind,
  type OptimizeSizeAssessment,
  type OptimizeSizeRisk,
  type OptimizeStatus,
  type OptimizeStatusCallback,
  type OptimizeStep,
  type OptimizeTypeAssessment,
  type OptimizeTypeRisk,
  type OptimizeTypeSample,
  optimizersForPotential,
  type PotentialKind,
  packCoords,
  probeBrowserMemory,
  resolveOptimizeMemoryBudget,
  resolveOptimizePair,
  runDampedOptimize,
  runLbfgsOptimize,
  softPairBudget,
  unpackCoords,
} from "./relax";
export {
  type OptimizeOptions,
  type OptimizeOutcome,
  runOptimize,
  UnsavedSceneError,
} from "./structure";
export {
  type OptimizeOnWorkerCallbacks,
  runOptimizeOnWorker,
} from "./worker_client";
