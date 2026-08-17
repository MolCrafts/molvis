/**
 * Structure optimization, layered the same way as `../compute`:
 *
 * | Layer | Module | Thread |
 * |-------|--------|--------|
 * | Wire | `protocol.ts` | both |
 * | Main | `assess.ts`, `structure.ts`, `worker_client.ts`, `live_paint.ts` | main |
 * | Kernel | `relax.ts`, `job_runner.ts` | worker only |
 *
 * This barrel re-exports wire + main only. The worker imports kernels
 * by path. Compose via {@link resolveOptimizePair}; the product entry
 * is {@link runOptimize}.
 */

export {
  assessFrameForOptimize,
  assessOptimizeAtomTypes,
  assessOptimizeSize,
  classifyOptimizeFailure,
  defaultOptimizeReportEvery,
  defaultOptimizer,
  estimateOptimizePeakBytes,
  estimateSoftPairs,
  formatOptimizeError,
  isMolrsPotential,
  isWasmPanic,
  LBFGS_MAX_ATOMS,
  OPTIMIZE_STALL_MS,
  type OptimizeFailureClass,
  type OptimizePair,
  type OptimizePhase,
  type OptimizeResourceProbe,
  type OptimizerKind,
  type OptimizeSizeAssessment,
  type OptimizeSizeRisk,
  type OptimizeStatus,
  type OptimizeStatusCallback,
  type OptimizeTypeAssessment,
  type OptimizeTypeRisk,
  type OptimizeTypeSample,
  optimizersForPotential,
  type PotentialKind,
  packCoords,
  probeBrowserMemory,
  resolveOptimizeMemoryBudget,
  resolveOptimizePair,
  softPairBudget,
  unpackCoords,
} from "./assess";
export {
  type LivePaintTick,
  type LivePaintWriter,
  OptimizeLivePaint,
} from "./live_paint";
export type {
  OptimizeCoordsProgress,
  OptimizeJobPayload,
  OptimizeJobResult,
  OptimizeProgress,
  OptimizeStatusProgress,
  OptimizeStatusWire,
  OptimizeStepProgress,
} from "./protocol";
export type {
  DampedOptimizeInput,
  LbfgsOptimizeInput,
  OptimizeResult,
  OptimizeStep,
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
