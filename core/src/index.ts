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

export { MolvisApp as Molvis } from "./app";
export {
  defaultMolvisConfig,
  DEFAULT_CONFIG,
  type MolvisConfig,
} from "./config";
export {
  Settings,
  DEFAULT_SETTING,
  defaultMolvisSettings,
  type MolvisSetting,
  type LightingSettings,
} from "./settings";
export {
  Frame,
  Block,
  Box,
  WasmArray,
  MolRecReader,
  SDFReader,
  Trajectory,
  type FrameProvider,
  parseSMILES,
  generate3D,
  WasmPca2,
  WasmPcaResult,
  WasmKMeans,
} from "./system/index";
export type { SmilesIR } from "./system/index";
export { Topology } from "./system/topology";
export { System } from "./system";
export { World } from "./world";
export {
  SelectionManager,
  type SelectionState,
  parseSelectionKey,
} from "./selection_manager";
export { ModeType } from "./mode";
export { ModifierRegistry } from "./pipeline/modifier_registry";
export { ModifierPipeline, PipelineEvents } from "./pipeline";
export {
  ModifierCapability,
  primaryCapabilityLabel,
} from "./pipeline/modifier";
export type { Modifier } from "./pipeline/modifier";
export { SelectionMask } from "./pipeline/types";
export { nextModifierId } from "./pipeline/modifier_registry";
export {
  isSelectionProducer,
  isTopologyChanging,
} from "./pipeline/nato_ids";

export {
  type DataSourceKind,
  DataSourceModifier,
  type DataSourceOptions,
  FrameDataSource,
  TrajectoryDataSource,
} from "./pipeline/data_source_modifier";
export { DrawAtomModifier } from "./pipeline/draw_atom";
export { DrawBondModifier } from "./pipeline/draw_bond";
export { DrawBoxModifier } from "./pipeline/draw_box";
export { DrawIsosurfaceModifier } from "./pipeline/draw_isosurface";
export {
  DEFAULT_ISOSURFACE_STYLE,
  type IsosurfaceRenderMode,
  type IsosurfaceStyle,
} from "./artist/isosurface/isosurface_renderer";
export { DrawRibbonModifier } from "./pipeline/draw_ribbon";
export type {
  RibbonColorMode,
  RibbonStyle,
} from "./artist/ribbon/ribbon_style";
export { SliceModifier } from "./modifiers/SliceModifier";
export { ExpressionSelectionModifier } from "./modifiers/ExpressionSelectionModifier";
export { HideSelectionModifier } from "./modifiers/HideSelectionModifier";
export { AssignColorModifier } from "./modifiers/AssignColorModifier";
export { ColorByPropertyModifier } from "./modifiers/ColorByPropertyModifier";
export { DeleteSelectedModifier } from "./modifiers/DeleteSelectedModifier";
export { HideHydrogensModifier } from "./modifiers/HideHydrogensModifier";
export { TransparentSelectionModifier } from "./modifiers/TransparentSelectionModifier";
export { SelectModifier } from "./modifiers/SelectModifier";
export {
  ColorMap,
  DEFAULT_CATEGORICAL_COLOR_MAP,
  buildCategoricalColorLookup,
  getCategoricalPalette,
  getColorMap,
  getPaletteDefinition,
  listColorMaps,
  listContinuousColorMaps,
  listPaletteDefinitions,
  type LinearRGB,
  type PaletteDefinition,
  type PaletteEntry,
  type PaletteSummary,
} from "./artist/palette";

export {
  computeRdf,
  type RdfParams,
  type RdfResult,
} from "./analysis/rdf";
export {
  computeClusters,
  type ClusterParams,
  type ClusterResult,
  type ConnectivityMode,
} from "./analysis/cluster";
export {
  MsdAnalyzer,
  computeMsd,
  type MsdFrameResult,
  type MsdResult,
} from "./analysis/msd";
export {
  computeClusterProperties,
  type ClusterPropertiesParams,
  type ClusterPropertiesResult,
} from "./analysis/cluster_properties";
export {
  detectRings,
  isAtomInRing,
  type RingInfo,
} from "./analysis/rings";
export {
  analyzeTopology,
  getTopologyNeighbors,
  getTopologyDegree,
  type TopologyAnalysisResult,
} from "./analysis/topology_analysis";
export {
  discoverAtomColumns,
  extractAtomRows,
  extractBondRows,
  type ColumnDescriptor,
  type AtomRow,
  type BondRow,
} from "./data_inspector";
export {
  EventEmitter,
  type BackendStateSync,
  type BackendStateSyncPipelineEntry,
  type Listener,
  type MolvisEventMap,
} from "./events";
export {
  pointInPolygon,
  simplifyPolyline,
  type Point2D,
} from "./selection/fence";

export {
  LabelRenderer,
  type LabelConfig,
  type LabelMode,
  DEFAULT_LABEL_CONFIG,
} from "./artist/label_renderer";
export { ClassicTheme } from "./artist/presets/classic";
export { ModernTheme } from "./artist/presets/modern";
export type { RepresentationStyle } from "./artist/representation";
export {
  REPRESENTATIONS,
  BALL_AND_STICK,
  SPACEFILL,
  STICK,
  findRepresentation,
} from "./artist/representation";

// Overlay system
export { OverlayManager } from "./overlays/overlay_manager";
export { Arrow3DOverlay } from "./overlays/arrow3d";
export { Arrow2DOverlay } from "./overlays/arrow2d";
export { TextLabelOverlay } from "./overlays/text_label";
export { VectorFieldOverlay } from "./overlays/vector_field";
export { MarkAtomOverlay } from "./overlays/mark_atom";
export type {
  Overlay,
  AtomAnchored,
  Arrow3DProps,
  Arrow2DProps,
  TextLabelProps,
  VectorFieldProps,
  MarkAtomProps,
  MarkShape,
  MarkLabel,
} from "./overlays/types";
export { VectorFieldModifier } from "./modifiers/VectorFieldModifier";
export type { VectorFieldModifierConfig } from "./modifiers/VectorFieldModifier";
export {
  AddOverlayCommand,
  RemoveOverlayCommand,
  UpdateOverlayCommand,
} from "./commands/overlays";
export { MarkAtomCommand, UnmarkAtomCommand } from "./commands/mark_atom";

export { registerDefaultCommands } from "./commands";
export { registerDefaultModifiers } from "./pipeline/modifier_registry";

export {
  cropToContent,
  cropToRect,
  reencodeImage,
  findAlphaBounds,
  type CropBounds,
  type CropOptions,
} from "./utils/image_crop";

export {
  attachWebSocketBridge,
  applyBackendState,
  WebSocketBridge,
  EventForwarder,
  RPCRouter,
  type AttachWebSocketBridgeOpts,
  type BridgeConnectResult,
  type JsonRPCRequest,
  type JsonRPCResponse,
  type BinaryBufferRef,
  type SerializedFrameData,
  type SerializedBoxData,
  type RPCResponseEnvelope,
} from "./transport";
