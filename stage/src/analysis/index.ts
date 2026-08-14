/**
 * Analysis, layered the same way as `../compute` and `../optimize`:
 *
 * | Layer | Module | Thread |
 * |-------|--------|--------|
 * | Wire | `analysis_ids.ts`, `worker_protocol.ts` | both |
 * | Main | `dispatch.ts`, `registry.ts`, `requirements.ts`, `rdf_params.ts`, `trajectory_runner.ts`, `cluster.ts`, `cluster_mask.ts`, `cluster_properties.ts`, `rings.ts`, `topology_analysis.ts`, `exploration.ts`, `panel_inputs.ts`, `utils.ts`, `worker_client.ts` | main |
 * | Kernel | `job_runner.ts`, `rdf.ts`, `msd.ts`, `trajectory_analyses.ts`, `frame_subset.ts` | worker only |
 *
 * *Wire* holds the names and plain data both threads share. *Main* runs on the
 * browser's main thread, so it may reach the DOM (Document Object Model, the
 * live page) and the renderer. *Kernel* runs inside the analysis Web Worker —
 * a browser background thread with neither, reachable only by message passing.
 *
 * This barrel re-exports wire + main only. The worker imports kernels by path,
 * and so does anything a kernel needs (`rdf_params`, `trajectory_runner`).
 * **Failure mode this rule exists for:** a worker entry that imported this
 * barrel would pull `dispatch` / `worker_client` / the pipeline-facing modules
 * into the worker chunk, dragging main-thread dependencies (the DOM, and
 * Babylon.js — the WebGL engine this package renders with) into a thread that
 * has neither. Add a module here only after checking no kernel reaches it.
 *
 * Pure re-exports, no import-time side effect — keep this module out of
 * `stage/package.json`'s `sideEffects` allowlist.
 */

export {
  CLUSTER_ANALYSIS_ID,
  COM_ANALYSIS_ID,
  MSD_ANALYSIS_ID,
  POWER_SPECTRUM_ANALYSIS_ID,
  RDF_ANALYSIS_ID,
  RG_ANALYSIS_ID,
  VORONOI_DOMAIN_ANALYSIS_ID,
  VORONOI_RADICAL_ANALYSIS_ID,
  VORONOI_VOID_ANALYSIS_ID,
} from "./analysis_ids";
export {
  type ClusterParams,
  type ClusterResult,
  type ConnectivityMode,
  computeClusters,
} from "./cluster";
export {
  CLUSTER_COLUMN_PREFIX,
  CLUSTER_MASK_COLUMN,
  type ClusterMaskPropertiesParams,
  type ClusterMaskPropertiesResult,
  clusterColumnName,
  computeClusterMaskProperties,
  groupByClusterMask,
  isClusterMaskColumn,
  listClusterColumns,
  parseClusterSlot,
  readClusterMask,
  resolveClusterColumn,
  summarizeClusterMask,
} from "./cluster_mask";
export {
  type ClusterPropertiesParams,
  type ClusterPropertiesResult,
  computeClusterProperties,
} from "./cluster_properties";
export {
  type AnalysisParamValues,
  type AnalysisRunResult,
  AnalysisUnsupportedError,
  runAnalysis,
} from "./dispatch";
export {
  type DatasetExploration,
  type ExplorationColorBy,
  type ExplorationConfig,
  runExploration,
} from "./exploration";
export {
  angleTriples,
  atomLabels,
  bondPairs,
  dihedralQuads,
  voidMask,
} from "./panel_inputs";
export {
  estimateBoundingBoxVolume,
  estimateBoundingSphereVolume,
  estimateNBins,
  frameHasBox,
  type PairRepresentation,
  type RdfParams,
  type RdfResult,
  type ReferenceVolumeSource,
  type ResolvedPairRepresentation,
  representationYLabel,
  resolvePairRepresentation,
} from "./rdf_params";
export {
  type AnalysisCatalog,
  type AnalysisCategory,
  type AnalysisDefinition,
  type AnalysisInputKind,
  type AnalysisParamKind,
  type AnalysisParamSlot,
  type AnalysisParamSpec,
  type AnalysisRequirement,
  type AnalysisResultKind,
  defaultAnalysisParams,
  getAnalysisCatalog,
  getAnalysisDefinition,
  listAnalyses,
  listAnalysisCategories,
  listAnalysisCategoriesWithEntries,
} from "./registry";
export {
  type AnalysisAvailability,
  analysisAvailability,
  atomColumns,
  frameHasStructure,
  type ProbeContext,
  probeRequirements,
  type RequirementSource,
  type RequirementStatus,
  stripCode,
  structureProbeKey,
} from "./requirements";
export { detectRings, isAtomInRing, type RingInfo } from "./rings";
export {
  analyzeTopology,
  getTopologyDegree,
  getTopologyNeighbors,
  type TopologyAnalysisResult,
} from "./topology_analysis";
export {
  AnalysisAbortError,
  type AnalysisAtomSelection,
  type AnalysisFrameFailure,
  type AnalysisProgress,
  type AnalysisRunOptions,
  type AnalysisTrajectorySource,
  type AtomTrackingKey,
  type AtomTrackingMode,
  expandFrameRange,
  type FrameRange,
  type ResolvedTrackedAtoms,
  resolveTrackedAtomIndices,
  resolveTrackedAtomSelection,
  type TrackedAtomSelection,
} from "./trajectory_runner";
export { estimateRMax } from "./utils";
export {
  type AnalysisOnWorkerCallbacks,
  runAnalysisOnWorker,
} from "./worker_client";
export {
  type AnalysisFrameSnapshot,
  type AnalysisJobPayload,
  type AnalysisJobProgress,
  type AnalysisJobResult,
  snapshotFrameForAnalysis,
} from "./worker_protocol";
