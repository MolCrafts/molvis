import { MolvisApp } from "./app";
import type { MolvisConfig } from "./config";

import type { MolvisSetting } from "./settings";

export type {
  MolvisViewerControl,
  MolvisViewerElement,
  MolvisViewerMode,
  MolvisViewerOptions,
  MolvisViewerRepresentation,
  MolvisViewerSource,
} from "./element";
export { MOLVIS_VERSION } from "./version";

/**
 * Mount a new MolVis application into an existing DOM container.
 */
export function mountMolvis(
  container: HTMLElement,
  config: MolvisConfig = {},
  settings?: Partial<MolvisSetting>,
): MolvisApp {
  return new MolvisApp(container, config, settings);
}

export {
  type CropBounds,
  type CropOptions,
  cropToContent,
  cropToRect,
  findAlphaBounds,
  reencodeImage,
} from "@molcrafts/molvis-core/image-crop";
export {
  clearOpfsCache,
  type OpfsCacheUsage,
  readOpfsCacheUsage,
} from "@molcrafts/molvis-core/opfs";
export {
  FF_NONBONDED_CUTOFF_A,
  type ForceFieldNeighborMethod,
  forceFieldNonbondedCutoff,
  type NeighborAlgorithmContext,
  type NeighborAlgorithmKind,
  SpatialNeighborQuery,
  type SpatialNeighborQueryOptions,
} from "./algo/neighbor_list";
export {
  AnalysisAbortError,
  type AnalysisAtomSelection,
  type AnalysisAvailability,
  type AnalysisCatalog,
  type AnalysisCategory,
  type AnalysisDefinition,
  type AnalysisFrameFailure,
  type AnalysisFrameSnapshot,
  type AnalysisInputKind,
  type AnalysisJobPayload,
  type AnalysisJobProgress,
  type AnalysisJobResult,
  type AnalysisOnWorkerCallbacks,
  type AnalysisParamKind,
  type AnalysisParamSlot,
  type AnalysisParamSpec,
  type AnalysisParamValues,
  type AnalysisProgress,
  type AnalysisRequirement,
  type AnalysisResultKind,
  type AnalysisRunOptions,
  type AnalysisRunResult,
  type AnalysisShapeResult,
  type AnalysisTrajectorySource,
  AnalysisUnsupportedError,
  type AtomTrackingKey,
  type AtomTrackingMode,
  analysisAvailability,
  analyzeTopology,
  angleTriples,
  atomColumns,
  atomLabels,
  bondPairs,
  CLUSTER_ANALYSIS_ID,
  CLUSTER_COLUMN_PREFIX,
  CLUSTER_MASK_COLUMN,
  type ClusterMaskPropertiesParams,
  type ClusterMaskPropertiesResult,
  type ClusterParams,
  type ClusterPropertiesParams,
  type ClusterPropertiesResult,
  type ClusterResult,
  type ConnectivityMode,
  clusterColumnName,
  computeClusterMaskProperties,
  computeClusterProperties,
  computeClusters,
  type DatasetExploration,
  defaultAnalysisParams,
  detectRings,
  dihedralQuads,
  type ExplorationColorBy,
  type ExplorationConfig,
  estimateBoundingBoxVolume,
  estimateBoundingSphereVolume,
  estimateNBins,
  estimateRMax,
  expandFrameRange,
  type FrameRange,
  frameHasBox,
  frameHasStructure,
  getAnalysisCatalog,
  getAnalysisDefinition,
  getTopologyDegree,
  getTopologyNeighbors,
  groupByClusterMask,
  isAtomInRing,
  isClusterMaskColumn,
  listAnalyses,
  listAnalysisCategories,
  listAnalysisCategoriesWithEntries,
  listClusterColumns,
  MSD_ANALYSIS_ID,
  type PairRepresentation,
  POWER_SPECTRUM_ANALYSIS_ID,
  type ProbeContext,
  parseClusterSlot,
  probeRequirements,
  RDF_ANALYSIS_ID,
  type RdfParams,
  type RdfResult,
  type ReferenceVolumeSource,
  type RequirementSource,
  type RequirementStatus,
  type ResolvedPairRepresentation,
  type ResolvedTrackedAtoms,
  type RingInfo,
  readClusterMask,
  representationYLabel,
  resolveClusterColumn,
  resolvePairRepresentation,
  resolveTrackedAtomIndices,
  resolveTrackedAtomSelection,
  runAnalysis,
  runAnalysisOnWorker,
  runExploration,
  snapshotCoversAnalysis,
  snapshotFrameForAnalysis,
  stripCode,
  structureProbeKey,
  summarizeClusterMask,
  type TopologyAnalysisResult,
  type TrackedAtomSelection,
  VORONOI_DOMAIN_ANALYSIS_ID,
  VORONOI_RADICAL_ANALYSIS_ID,
  VORONOI_VOID_ANALYSIS_ID,
  voidMask,
} from "./analysis";
// Kernel modules (worker-only) are never re-exported by `./analysis`; their
// public types come straight from the file. See `./analysis/index.ts`.
export type { MsdFrameResult, MsdResult } from "./analysis/msd";
export type {
  MsdTrajectoryParams,
  MsdTrajectoryResult,
  RdfTrajectoryParams,
  RdfTrajectoryResult,
} from "./analysis/trajectory_analyses";
export { MolvisApp as Molvis } from "./app";
export {
  type CategoricalSequenceOptions,
  categoricalSequence,
} from "./artist/categorical_palette";
export {
  type CategoricalColorStrategy,
  OvitoStrategy,
  Tab10Strategy,
} from "./artist/categorical_theme";
export {
  DEFAULT_ISOSURFACE_STYLE,
  type IsosurfaceRenderMode,
  type IsosurfaceStyle,
  type SurfaceStyle,
} from "./artist/isosurface/isosurface_renderer";
export {
  DEFAULT_LABEL_CONFIG,
  type LabelConfig,
  type LabelMode,
  LabelRenderer,
} from "./artist/label_renderer";
export {
  buildCategoricalColorLookup,
  buildSourceColorLegend,
  ColorMap,
  categoricalColorAt,
  getColorMap,
  getPaletteDefinition,
  hexToLinearRgb,
  type LinearRGB,
  listColorMaps,
  listContinuousColorMaps,
  listPaletteDefinitions,
  type PaletteDefinition,
  type PaletteEntry,
  type PaletteSummary,
  relativeLuminanceHex,
} from "./artist/palette";
export { ModernTheme } from "./artist/presets/modern";
export type {
  AtomVisibility,
  BondColorMode,
  BondOrderMode,
  RadiusMode,
  RepresentationId,
  RepresentationLabelMode,
  RepresentationStyle,
  ShadingMode,
} from "./artist/representation";
export {
  BALL_AND_STICK,
  BALL_AND_TUBE,
  BUBBLE,
  FLAT,
  findRepresentation,
  GRAPH,
  METAL_TUBE,
  REPRESENTATION_IDS,
  REPRESENTATIONS,
  SKELETAL,
  SPACEFILL,
  TUBE,
  WIREFRAME,
} from "./artist/representation";
export type {
  RibbonColorMode,
  RibbonStyle,
} from "./artist/ribbon/ribbon_style";
export type { CategoricalThemeId } from "./artist/style_manager";
export {
  CameraAnimator,
  type TurntableOptions,
  type TurntableSpec,
} from "./camera/animator";
export { pickViewDirection } from "./camera/auto_view";
export type { CameraPosePayload } from "./camera/control";
export {
  fitCameraView,
  lookAtCamera,
  readCameraPose,
  resetCameraView,
  setCameraPose,
} from "./camera/control";
export {
  aabbToObb,
  type BoxFit,
  fitBoxToView,
  type ViewAngles,
  type ViewFitOptions,
} from "./camera/fit";
export {
  catmullRomVec3,
  interpolatePose,
  lerpVec3,
  slerpVec3,
} from "./camera/interpolate";
export { computeObb, type Obb } from "./camera/obb";
// Programmable camera trajectories (turntable v1)
export type { CameraPose, Vec3 } from "./camera/pose";
export { applyPose } from "./camera/pose";
export type {
  CameraKeyframe,
  CameraTrack,
  KeyframeTrackConfig,
  TurntableConfig,
} from "./camera/track";
export { KeyframeTrack, TurntableTrack } from "./camera/track";
export { commands, registerDefaultCommands } from "./commands";
export { MarkAtomCommand, UnmarkAtomCommand } from "./commands/mark_atom";
export {
  AddOverlayCommand,
  RemoveOverlayCommand,
  UpdateOverlayCommand,
} from "./commands/overlays";
export { warmComputeWorker } from "./compute";
export type { ContextMenuBuildContext, ContextMenuConfig } from "./config";
export {
  DEFAULT_CONFIG,
  defaultMolvisConfig,
  isModeEnabled,
  type MolvisConfig,
} from "./config";
export {
  applyCoordinatePolicy,
  COORDINATE_POLICIES,
  COORDINATE_POLICY_LABELS,
  type CoordinatePolicy,
  frameWithCoords,
  isCoordinatePolicy,
  type UnwrapState,
  wrapAtoms,
  wrapMoleculeAware,
  wrapMolecules,
} from "./coords";
export {
  type AtomRow,
  type BondColumns,
  type BondRow,
  type ColumnDescriptor,
  type ColumnSortKeys,
  discoverAtomColumns,
  extractAtomRows,
  extractAtomRowsAt,
  extractAtomSortKeys,
  extractBondColumns,
  extractBondRows,
} from "./data_inspector";
export {
  type BackendStateSync,
  type BackendStateSyncPipelineEntry,
  EventEmitter,
  type Listener,
  type MolvisEventMap,
} from "./events";
export { exportFrameToGLB, type GltfExportOptions } from "./export/gltf";
export {
  CELL_TILT_EPS,
  hMatrixFromLammps,
  type LammpsCell,
  lammpsCellFromBox,
} from "./io/box_lammps";
export {
  cameraFacingBasis,
  identityPlacementBasis,
  intersectRayWithPlane,
  type ManipulateTool,
  type ModeId,
  ModeManager,
  ModeType,
  orientLocalOffset,
  type PlacementBasis,
  type PluginModeFactory,
  type PointerSpacePositionInput,
  resolvePointerSpacePosition,
  screenAlignedPlaneNormal,
  screenAlignedPlaneOrigin,
  selectionCentroid,
} from "./mode";
export { CommonMenuItems } from "./mode/menu_items";
export type { MenuItem, SceneHit } from "./mode/types";
export {
  type AffineMatrix3,
  AffineTransformationModifier,
} from "./modifiers/AffineTransformationModifier";
export { AssignColorModifier } from "./modifiers/AssignColorModifier";
export {
  type CameraTrackKey,
  CameraTrackModifier,
  type CameraTrackSpec,
} from "./modifiers/CameraTrackModifier";
export { CenterOfMassModifier } from "./modifiers/CenterOfMassModifier";
export { ClusterModifier } from "./modifiers/ClusterModifier";
export { ColorByPropertyModifier } from "./modifiers/ColorByPropertyModifier";
export { ColorByTypeModifier } from "./modifiers/ColorByTypeModifier";
export {
  type BondCriterion,
  ComputeBondsModifier,
} from "./modifiers/ComputeBondsModifier";
export { ComputePropertyModifier } from "./modifiers/ComputePropertyModifier";
export { ConstructSurfaceMeshModifier } from "./modifiers/ConstructSurfaceMeshModifier";
export { CoordinationPolyhedraModifier } from "./modifiers/CoordinationPolyhedraModifier";
export { DeleteSelectedModifier } from "./modifiers/DeleteSelectedModifier";
export {
  DISPLACEMENT_X,
  DISPLACEMENT_Y,
  DISPLACEMENT_Z,
  DisplacementVectorsModifier,
} from "./modifiers/DisplacementVectorsModifier";
export { EditTypesModifier } from "./modifiers/EditTypesModifier";
export {
  type ExpandSelectionMode,
  ExpandSelectionModifier,
} from "./modifiers/ExpandSelectionModifier";
export { ExpressionSelectionModifier } from "./modifiers/ExpressionSelectionModifier";
export { FreezePropertyModifier } from "./modifiers/FreezePropertyModifier";
export { HideHydrogensModifier } from "./modifiers/HideHydrogensModifier";
export { HideSelectionModifier } from "./modifiers/HideSelectionModifier";
export { InvertSelectionModifier } from "./modifiers/InvertSelectionModifier";
export { RadiusOfGyrationModifier } from "./modifiers/RadiusOfGyrationModifier";
export { ReplicateModifier } from "./modifiers/ReplicateModifier";
export {
  ClearSelectionModifier,
  SelectModifier,
} from "./modifiers/SelectModifier";
export { SelectOverlappingModifier } from "./modifiers/SelectOverlappingModifier";
export { SelectTypeModifier } from "./modifiers/SelectTypeModifier";
export { SliceModifier } from "./modifiers/SliceModifier";
export { SmoothTrajectoryModifier } from "./modifiers/SmoothTrajectoryModifier";
export { SolidLiquidModifier } from "./modifiers/SolidLiquidModifier";
export { SteinhardtOrderModifier } from "./modifiers/SteinhardtOrderModifier";
export {
  SOLID_LIQUID_COLUMN,
  SOLID_LIQUID_N_BONDS_COLUMN,
  STEINHARDT_Q_PREFIX,
  STEINHARDT_W_PREFIX,
  steinhardtQColumn,
  steinhardtWColumn,
} from "./modifiers/structure_order_shared";
export { TrajectoryLinesModifier } from "./modifiers/TrajectoryLinesModifier";
export { TransparentSelectionModifier } from "./modifiers/TransparentSelectionModifier";
export { UnwrapTrajectoriesModifier } from "./modifiers/UnwrapTrajectoriesModifier";
export type { VectorFieldModifierConfig } from "./modifiers/VectorFieldModifier";
export { VectorFieldModifier } from "./modifiers/VectorFieldModifier";
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
  type OptimizeOptions,
  type OptimizeOutcome,
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
  runOptimize,
  softPairBudget,
  UnsavedSceneError,
  unpackCoords,
} from "./optimize";
export { Arrow2DOverlay } from "./overlays/arrow2d";
export { Arrow3DOverlay } from "./overlays/arrow3d";
export { LineSystemOverlay } from "./overlays/line_system";
export { MarkAtomOverlay } from "./overlays/mark_atom";
// Overlay system
export { OverlayManager } from "./overlays/overlay_manager";
export {
  type PointMarker,
  PointMarkersOverlay,
  type PointMarkersProps,
} from "./overlays/point_markers";
export {
  type BoxRegion,
  buildRegionLines,
  type CylinderRegion,
  type EllipsoidRegion,
  type GaussianRegion,
  type PlaneRegion,
  type RegionShape,
  type RegionStyle,
  RegionWireframeOverlay,
  type RegionWireframeSpec,
  type SphereRegion,
} from "./overlays/region_wireframe";
export { TextLabelOverlay } from "./overlays/text_label";
export type {
  Arrow2DProps,
  Arrow3DProps,
  AtomAnchored,
  MarkAtomProps,
  MarkLabel,
  MarkShape,
  Overlay,
  TextLabelProps,
  VectorFieldProps,
} from "./overlays/types";
export { VectorFieldOverlay } from "./overlays/vector_field";
export { ModifierPipeline, PipelineEvents } from "./pipeline";
export { applyAutoAttach } from "./pipeline/auto_attach";
// COM_ANALYSIS_ID / RG_ANALYSIS_ID are declared once in
// `./analysis/analysis_ids` — the import-free id table — and reach the public
// surface through `cluster_pipeline`, which also owns the two predicates over
// them. The `./analysis` barrel re-exports the same two constants, so the
// analysis block above deliberately leaves them out — one route to the public
// surface, and never a second declaration.
export {
  COM_ANALYSIS_ID,
  createClusterModifier,
  ensureCenterOfMassModifier,
  ensureClusterModifier,
  ensureRadiusOfGyrationModifier,
  findCenterOfMassModifier,
  findClusterModifier,
  findClusterModifiers,
  findRadiusOfGyrationModifier,
  isComAnalysisId,
  isRgAnalysisId,
  nextClusterSlot,
  RG_ANALYSIS_ID,
} from "./pipeline/cluster_pipeline";
export {
  DATA_SOURCE_CATEGORY,
  DataSource,
  type DataSourceKind,
  type DataSourceOptions,
  FileDataSource,
  MemoryDataSource,
} from "./pipeline/data_source";
export { DrawAtomModifier } from "./pipeline/draw_atom";
export { DrawBondModifier } from "./pipeline/draw_bond";
export {
  DrawBoxModifier,
  type DrawBoxSpec,
} from "./pipeline/draw_box";
export { DrawIsosurfaceModifier } from "./pipeline/draw_isosurface";
export { DrawRibbonModifier } from "./pipeline/draw_ribbon";
export {
  bootstrapEmptyPipeline,
  createEmptyPrimaryDataSource,
  EMPTY_SCENE_FILENAME,
  ensurePrimaryDataSource,
  installEmptyPrimaryScene,
  primaryDataSource,
} from "./pipeline/empty_scene";
export type { PipelineEntry } from "./pipeline/entry";
export { GaussianDensitySurfaceModifier } from "./pipeline/gaussian_density_surface";
export type { Modifier } from "./pipeline/modifier";
export {
  BaseModifier,
  ModifierCapability,
} from "./pipeline/modifier";
export type {
  ModifierCategory,
  RegisterModifierOptions,
} from "./pipeline/modifier_registry";
export {
  MODIFIER_CATEGORIES,
  ModifierRegistry,
  nextModifierId,
  registerDefaultModifiers,
} from "./pipeline/modifier_registry";
export {
  isSelectionProducer,
  isTopologyChanging,
} from "./pipeline/nato_ids";
export { Session } from "./pipeline/session";
export {
  StreamDataSource,
  type StreamDataSourceOptions,
  type StreamMode,
} from "./pipeline/stream_data_source";
export type { PipelineContext } from "./pipeline/types";
export { SelectionMask } from "./pipeline/types";
export {
  isNamespacedPluginId,
  namespacePluginId,
  PLUGIN_ID_PREFIX,
  PLUGIN_ID_SEPARATOR,
  pluginIdLeaf,
} from "./plugin_id";
export {
  downloadProjectJson,
  hydrateProject,
  isMolvisProject,
  MOLVIS_PROJECT_FORMAT,
  type MolvisProject,
  type PortableFrame,
  type ProjectPipelineEntry,
  serializeProject,
  serializeProjectJson,
} from "./project";
export {
  type AnimationOptions,
  MolvisRenderer,
  type MolvisRendererOptions,
  type RenderInput,
  type SnapshotOptions,
} from "./renderer";
export {
  type Point2D,
  pointInPolygon,
  simplifyPolyline,
} from "./selection/fence";
export {
  parseSelectionKey,
  SelectionManager,
  type SelectionState,
} from "./selection_manager";
export {
  DEFAULT_SETTING,
  defaultMolvisSettings,
  type LightingSettings,
  type MolvisSetting,
  Settings,
} from "./settings";
export { System } from "./system";
export type { SmilesIR } from "./system/index";
export {
  Block,
  Box,
  Frame,
  type FrameProvider,
  frameToTrajectory,
  generate3D,
  Perceive,
  parseSMILES,
  RecordReader,
  SDFReader,
  Trajectory,
  WasmArray,
  WasmKMeans,
  WasmPca2,
  WasmPcaResult,
} from "./system/index";
export {
  type CompositionSource,
  type CompositionValidationResult,
  composeSources,
  extendFrames,
  extendSourcesToTrajectory,
  validateSourceComposition,
} from "./system/source_composition";
export {
  buildStructureOutline,
  type StructureOutline,
  type StructureOutlineNode,
} from "./system/structure_outline";
export { Topology } from "./system/topology";
export {
  type AttachWebSocketBridgeOpts,
  applyBackendState,
  attachWebSocketBridge,
  BinaryResult,
  type BridgeConnectResult,
  decodeBox,
  decodeFrame,
  EventForwarder,
  encodeFrame,
  FramePayloadError,
  isRpcMethodName,
  type JsonRPCRequest,
  type JsonRPCResponse,
  listRpcExtensionHandlers,
  listRpcMethods,
  RPC_METHODS,
  RPC_PROTOCOL_VERSION,
  type RPCResponseEnvelope,
  RPCRouter,
  type RpcMethodName,
  registerRpcExtensionHandler,
  WebSocketBridge,
} from "./transport";
export { createLogger, logger } from "./utils/logger";
export { World } from "./world";
