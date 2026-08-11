// Core pipeline types and utilities

// Built-in modifiers
export {
  type AffineMatrix3,
  AffineTransformationModifier,
} from "../modifiers/AffineTransformationModifier";
export { ColorByTypeModifier } from "../modifiers/ColorByTypeModifier";
export {
  type ExpandSelectionMode,
  ExpandSelectionModifier,
} from "../modifiers/ExpandSelectionModifier";
export { InvertSelectionModifier } from "../modifiers/InvertSelectionModifier";
export { ReplicateModifier } from "../modifiers/ReplicateModifier";
export {
  ClearSelectionModifier,
  SelectModifier,
} from "../modifiers/SelectModifier";
export { SelectTypeModifier } from "../modifiers/SelectTypeModifier";
export { UnwrapTrajectoriesModifier } from "../modifiers/UnwrapTrajectoriesModifier";
export { WrapPBCModifier } from "../modifiers/WrapPBCModifier";
// Bond column remap (paired with the file-load column-mapping dialog)
export {
  type BondColumnMapping,
  BondColumnRemapModifier,
  bondsIntegerColumns,
  bondsNeedColumnMapping,
} from "./bond_column_remap";
// The two things a pipeline holds, and the base they share.
export {
  DATA_SOURCE_CATEGORY,
  DataSource,
  type DataSourceKind,
  type DataSourceOptions,
  FileDataSource,
  MemoryDataSource,
} from "./data_source";
// Pipeline bootstrap (empty list by default; user adds Source)
export {
  bootstrapEmptyPipeline,
  createEmptyPrimaryDataSource,
  EMPTY_SCENE_FILENAME,
  ensurePrimaryDataSource,
  installEmptyPrimaryScene,
  primaryDataSource,
} from "./empty_scene";
export type { PipelineEntry } from "./entry";
export type { Modifier } from "./modifier";
// Modifier base classes and interfaces
export {
  BaseModifier,
  ModifierCapability,
} from "./modifier";
export type {
  ModifierCategory,
  ModifierFactory,
  RegisterModifierOptions,
} from "./modifier_registry";
// Modifier registry
export {
  MODIFIER_CATEGORIES,
  ModifierRegistry,
  nextModifierId,
} from "./modifier_registry";
// NATO IDs and DAG utilities
export {
  generateNatoId,
  isSelectionProducer,
  isTopologyChanging,
  NATO_ALPHABET,
} from "./nato_ids";
// Pipeline execution
export { ModifierPipeline, PipelineEvents } from "./pipeline";
export { Session } from "./session";
export {
  StreamDataSource,
  type StreamDataSourceOptions,
  type StreamMode,
} from "./stream_data_source";
// Frame change classification (consumed by Draw modifiers)
export type {
  FrameChangeKind,
  PipelineContext,
  ValidationResult,
} from "./types";
export {
  createDefaultContext,
  pushSelectionScope,
  SelectionMask,
} from "./types";
