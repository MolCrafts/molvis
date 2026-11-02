/**
 * What a plugin may contribute to the 3D stage.
 *
 * These are stage's own concepts, not shared contract: a `Modifier` receives
 * a `PipelineContext` carrying the renderer, so it cannot be engine-neutral.
 * Each engine exposes its own contribution surface; `@molcrafts/molvis-plugin`
 * re-exports this one so plugin authors still import a single package.
 */

export type { MolvisApp as StageApp } from "./app";
export type { PluginMode, PluginModeFactory } from "./mode";
export { stageEditMolecule } from "./mode/edit_stamp";
export type { AtomAnchored, Overlay, Vec3 } from "./overlays/types";
export { DataSource } from "./pipeline/data_source";
export type { PipelineEntry } from "./pipeline/entry";
export type { GeometryProducer, Modifier } from "./pipeline/modifier";
// An enum is a runtime value, not just a type — plugins compare against it.
export {
  BaseModifier,
  ModifierCapability,
  producesGeometry,
} from "./pipeline/modifier";
export type { ModifierCategory } from "./pipeline/modifier_categories";
export { MODIFIER_CATEGORIES } from "./pipeline/modifier_categories";
export { nextModifierId } from "./pipeline/modifier_id";
export type { PipelineContext } from "./pipeline/types";
export { SelectionMask } from "./pipeline/types";
export type {
  ProjectParams,
  ProjectParamsCarrier,
} from "./project/params";
export { readEnum, readNumber } from "./project/params";
