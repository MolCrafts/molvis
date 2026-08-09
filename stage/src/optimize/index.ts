/**
 * Structure optimization: potential × optimizer.
 *
 * | Module | Role |
 * |--------|------|
 * | {@link structure} | App entry — snapshot, bonds/H, pipeline publish |
 * | {@link relax} | Potential runners (`runLbfgsOptimize` / `runDampedOptimize`) |
 *
 * Compose via {@link resolveOptimizePair}: e.g. UFF+lbfgs, soft+damped.
 */
export {
  assessFrameForOptimize,
  assessOptimizeAtomTypes,
  assessOptimizeSize,
  type DampedOptimizeInput,
  defaultOptimizeReportEvery,
  defaultOptimizer,
  estimateOptimizePeakBytes,
  estimateSoftPairs,
  isMolrsPotential,
  LBFGS_MAX_ATOMS,
  type LbfgsOptimizeInput,
  OPTIMIZE_STALL_MS,
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
  type PotentialKind,
  packCoords,
  probeBrowserMemory,
  resolveOptimizeMemoryBudget,
  resolveOptimizePair,
  runDampedOptimize,
  runLbfgsOptimize,
  softPairBudget,
  unpackCoords,
  yieldToUi,
} from "./relax";
export {
  type OptimizeOptions,
  type OptimizeOutcome,
  runOptimize,
  UnsavedSceneError,
} from "./structure";
