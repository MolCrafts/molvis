// Core pipeline types and utilities
export {
  SelectionMask,
  createDefaultContext,
  pushSelectionScope,
} from "./types";
export type { PipelineContext, ValidationResult } from "./types";

// Modifier base classes and interfaces
export {
  ModifierCapability,
  BaseModifier,
  primaryCapabilityLabel,
} from "./modifier";
export type { Modifier } from "./modifier";

// Frame change classification (consumed by Draw modifiers)
export type { FrameChangeKind } from "./types";

// Pipeline execution
export { ModifierPipeline, PipelineEvents } from "./pipeline";

// Built-in modifiers
export {
  SelectModifier,
  ClearSelectionModifier,
} from "../modifiers/SelectModifier";
export { WrapPBCModifier } from "../modifiers/WrapPBCModifier";

// Bond column remap (paired with the file-load column-mapping dialog)
export {
  type BondColumnMapping,
  BondColumnRemapModifier,
  bondsIntegerColumns,
  bondsNeedColumnMapping,
} from "./bond_column_remap";

// Modifier registry
export { ModifierRegistry, nextModifierId } from "./modifier_registry";
export type { ModifierFactory } from "./modifier_registry";

// NATO IDs and DAG utilities
export {
  NATO_ALPHABET,
  generateNatoId,
  isSelectionProducer,
  isTopologyChanging,
} from "./nato_ids";
