import { MolvisApp } from "./app";
import type { MolvisConfig } from "./config";

import type { MolvisSetting } from "./settings";

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
  computeRdf,
  type RdfParams,
  type RdfResult,
} from "./analysis/rdf";
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
export { MolvisApp as Molvis } from "./app";
export {
  DEFAULT_ISOSURFACE_STYLE,
  type IsosurfaceRenderMode,
  type IsosurfaceStyle,
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
export type { RepresentationStyle } from "./artist/representation";
export {
  BALL_AND_STICK,
  findRepresentation,
  REPRESENTATIONS,
  SPACEFILL,
  STICK,
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
export {
  DEFAULT_CONFIG,
  defaultMolvisConfig,
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
export { ModeType } from "./mode";
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
export {
  type DataSourceKind,
  DataSourceModifier,
  type DataSourceOptions,
  FileDataSource,
  MemoryDataSource,
} from "./pipeline/data_source_modifier";
export { DrawAtomModifier } from "./pipeline/draw_atom";
export { DrawBondModifier } from "./pipeline/draw_bond";
export { DrawBoxModifier } from "./pipeline/draw_box";
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
  MolRecReader,
  parseSMILES,
  SDFReader,
  Trajectory,
  WasmArray,
  WasmKMeans,
  WasmPca2,
  WasmPcaResult,
} from "./system/index";
export type {
  SceneSynthesisConfig,
  SynthesisAlignment,
  SynthesisSource,
} from "./system/scene_synthesis";
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
