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
  type ClusterParams,
  type ClusterResult,
  type ConnectivityMode,
  computeClusters,
} from "./analysis/cluster";
export {
  type ClusterPropertiesParams,
  type ClusterPropertiesResult,
  computeClusterProperties,
} from "./analysis/cluster_properties";
export {
  type AnalysisParamValues,
  type AnalysisRunResult,
  AnalysisUnsupportedError,
  runAnalysis,
} from "./analysis/dispatch";
export {
  type DatasetExploration,
  type ExplorationColorBy,
  type ExplorationConfig,
  runExploration,
} from "./analysis/exploration";
export {
  computeMsd,
  MsdAnalyzer,
  type MsdFrameResult,
  type MsdResult,
} from "./analysis/msd";
export {
  angleTriples,
  atomLabels,
  bondPairs,
  dihedralQuads,
  voidMask,
} from "./analysis/panel_inputs";
export {
  computeRdf,
  type RdfParams,
  type RdfResult,
} from "./analysis/rdf";
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
} from "./analysis/registry";
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
} from "./analysis/requirements";
export {
  detectRings,
  isAtomInRing,
  type RingInfo,
} from "./analysis/rings";
export {
  analyzeTopology,
  getTopologyDegree,
  getTopologyNeighbors,
  type TopologyAnalysisResult,
} from "./analysis/topology_analysis";
export {
  computeMsdTrajectory,
  computeRdfTrajectory,
  type MsdTrajectoryParams,
  type MsdTrajectoryResult,
  type RdfTrajectoryParams,
  type RdfTrajectoryResult,
} from "./analysis/trajectory_analyses";
export {
  AnalysisAbortError,
  type AnalysisAtomSelection,
  type AnalysisFrameFailure,
  type AnalysisProgress,
  type AnalysisRunOptions,
  type AtomTrackingKey,
  type AtomTrackingMode,
  expandFrameRange,
  type FrameRange,
  type ResolvedTrackedAtoms,
  resolveTrackedAtomIndices,
  resolveTrackedAtomSelection,
  type TrackedAtomSelection,
} from "./analysis/trajectory_runner";
export { MolvisApp as Molvis } from "./app";
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
  DEFAULT_CATEGORICAL_COLOR_MAP,
  getCategoricalPalette,
  getColorMap,
  getPaletteDefinition,
  type LinearRGB,
  listColorMaps,
  listContinuousColorMaps,
  listPaletteDefinitions,
  type PaletteDefinition,
  type PaletteEntry,
  type PaletteSummary,
} from "./artist/palette";
export { ClassicTheme } from "./artist/presets/classic";
export { ModernTheme } from "./artist/presets/modern";
export { VividTheme } from "./artist/presets/vivid";
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
export {
  CameraAnimator,
  type TurntableOptions,
  type TurntableSpec,
} from "./camera/animator";
export { pickViewDirection } from "./camera/auto_view";
export {
  aabbToObb,
  type BoxFit,
  fitBoxToView,
  type ViewAngles,
  type ViewFitOptions,
} from "./camera/fit";
export { computeObb, type Obb } from "./camera/obb";
// Programmable camera trajectories (turntable v1)
export type { CameraPose, Vec3 } from "./camera/pose";
export { applyPose } from "./camera/pose";
export type { CameraTrack, TurntableConfig } from "./camera/track";
export { TurntableTrack } from "./camera/track";
export { registerDefaultCommands } from "./commands";
export { MarkAtomCommand, UnmarkAtomCommand } from "./commands/mark_atom";
export {
  AddOverlayCommand,
  RemoveOverlayCommand,
  UpdateOverlayCommand,
} from "./commands/overlays";
export type { ContextMenuBuildContext, ContextMenuConfig } from "./config";
export {
  DEFAULT_CONFIG,
  defaultMolvisConfig,
  isModeEnabled,
  type MolvisConfig,
} from "./config";
export {
  type AtomRow,
  type BondRow,
  type ColumnDescriptor,
  discoverAtomColumns,
  extractAtomRows,
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
export { ModeType } from "./mode";
export { CommonMenuItems } from "./mode/menu_items";
export type { HitResult, MenuItem } from "./mode/types";
export { AssignColorModifier } from "./modifiers/AssignColorModifier";
export { ColorByPropertyModifier } from "./modifiers/ColorByPropertyModifier";
export {
  type BondCriterion,
  ComputeBondsModifier,
} from "./modifiers/ComputeBondsModifier";
export { DeleteSelectedModifier } from "./modifiers/DeleteSelectedModifier";
export { ExpressionSelectionModifier } from "./modifiers/ExpressionSelectionModifier";
export { HideHydrogensModifier } from "./modifiers/HideHydrogensModifier";
export { HideSelectionModifier } from "./modifiers/HideSelectionModifier";
export { SelectModifier } from "./modifiers/SelectModifier";
export { SliceModifier } from "./modifiers/SliceModifier";
export { TransparentSelectionModifier } from "./modifiers/TransparentSelectionModifier";
export type { VectorFieldModifierConfig } from "./modifiers/VectorFieldModifier";
export { VectorFieldModifier } from "./modifiers/VectorFieldModifier";
export { Arrow2DOverlay } from "./overlays/arrow2d";
export { Arrow3DOverlay } from "./overlays/arrow3d";
export { MarkAtomOverlay } from "./overlays/mark_atom";
// Overlay system
export { OverlayManager } from "./overlays/overlay_manager";
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
export { SphereWireframeOverlay } from "./overlays/sphere_wireframe";
export { TextLabelOverlay } from "./overlays/text_label";
export type {
  Arrow2DProps,
  Arrow3DProps,
  AtomAnchored,
  MarkAtomProps,
  MarkLabel,
  MarkShape,
  Overlay,
  SphereWireframeProps,
  TextLabelProps,
  VectorFieldProps,
} from "./overlays/types";
export { VectorFieldOverlay } from "./overlays/vector_field";
export { ModifierPipeline, PipelineEvents } from "./pipeline";
export {
  DATA_SOURCE_CATEGORY,
  type DataSourceKind,
  DataSourceModifier,
  type DataSourceOptions,
  FileDataSource,
  MemoryDataSource,
} from "./pipeline/data_source_modifier";
export { DrawAtomModifier } from "./pipeline/draw_atom";
export { DrawBondModifier } from "./pipeline/draw_bond";
export { DrawBoxModifier, type DrawBoxSpec } from "./pipeline/draw_box";
export { DrawIsosurfaceModifier } from "./pipeline/draw_isosurface";
export { DrawRibbonModifier } from "./pipeline/draw_ribbon";
export type { Modifier } from "./pipeline/modifier";
export {
  ModifierCapability,
  primaryCapabilityLabel,
} from "./pipeline/modifier";
export {
  ModifierRegistry,
  nextModifierId,
  registerDefaultModifiers,
} from "./pipeline/modifier_registry";
export {
  isSelectionProducer,
  isTopologyChanging,
} from "./pipeline/nato_ids";
export { SelectionMask } from "./pipeline/types";
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
export { Topology } from "./system/topology";
export {
  type AttachWebSocketBridgeOpts,
  applyBackendState,
  attachWebSocketBridge,
  type BinaryBufferRef,
  type BridgeConnectResult,
  EventForwarder,
  type JsonRPCRequest,
  type JsonRPCResponse,
  type RPCResponseEnvelope,
  RPCRouter,
  type SerializedBoxData,
  type SerializedFrameData,
  WebSocketBridge,
} from "./transport";

export {
  type CropBounds,
  type CropOptions,
  cropToContent,
  cropToRect,
  findAlphaBounds,
  reencodeImage,
} from "./utils/image_crop";
export { World } from "./world";
