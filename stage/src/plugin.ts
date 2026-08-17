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
export type { AtomAnchored, Overlay, Vec3 } from "./overlays/types";
export { DataSource } from "./pipeline/data_source";
export type { PipelineEntry } from "./pipeline/entry";
export type { Modifier } from "./pipeline/modifier";
// An enum is a runtime value, not just a type — plugins compare against it.
export { ModifierCapability } from "./pipeline/modifier";
