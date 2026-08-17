/**
 * Shared host modules for plugin import-map injection.
 *
 * The specifier list is {@link PluginHostModuleId} in
 * `@molcrafts/molvis-plugin`. This map must inject every id on that list, and
 * nothing else — `satisfies` below enforces both directions at compile time,
 * so the two can no longer drift apart silently.
 *
 * Stage, molplot, and `@molcrafts/molvis-stage/export-gltf` are resolved
 * lazily. A static import of the stage barrel would pin every re-export
 * (RDF (radial distribution function) / MSD (mean-squared displacement)
 * kernels, L-BFGS (limited-memory BFGS optimizer)) into the viewer startup
 * graph; a static import of the glTF (Graphics Language Transmission
 * Format) exporter would pin `@babylonjs/serializers` the same way. The
 * exporter is **not** a stage-barrel re-export — it lives only on that
 * subpath.
 */

import * as MolvisElements from "@molcrafts/molvis-core/elements";
import * as MolvisKeys from "@molcrafts/molvis-core/keys";
import * as Molrs from "@molcrafts/molvis-core/molrs";
import * as MolvisPlugin from "@molcrafts/molvis-plugin";
import * as MolvisPluginUi from "@molcrafts/molvis-plugin/ui";
import * as React from "react";
import * as JsxDevRuntime from "react/jsx-dev-runtime";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";

export type { PluginHostModuleId } from "@molcrafts/molvis-plugin";

import type { PluginHostModuleId } from "@molcrafts/molvis-plugin";

/** Heavy plugin peers; the rest are eager. */
type LazyHostModuleId =
  | "@molcrafts/molplot"
  | "@molcrafts/molvis-stage"
  | "@molcrafts/molvis-stage/export-gltf";
type EagerHostModuleId = Exclude<PluginHostModuleId, LazyHostModuleId>;

const eagerPluginHostModules = {
  react: React,
  "react-dom": ReactDOM,
  "react-dom/client": ReactDOMClient,
  "react/jsx-runtime": JsxRuntime,
  "react/jsx-dev-runtime": JsxDevRuntime,
  "@molcrafts/molvis-plugin": MolvisPlugin,
  "@molcrafts/molvis-plugin/ui": MolvisPluginUi,
  "@molcrafts/molvis-core/molrs": Molrs,
  "@molcrafts/molvis-core/elements": MolvisElements,
  "@molcrafts/molvis-core/keys": MolvisKeys,
} as const satisfies Record<EagerHostModuleId, unknown>;

export type PluginHostModules = typeof eagerPluginHostModules & {
  "@molcrafts/molplot": typeof import("@molcrafts/molplot");
  "@molcrafts/molvis-stage": typeof import("@molcrafts/molvis-stage");
  "@molcrafts/molvis-stage/export-gltf": typeof import("@molcrafts/molvis-stage/export-gltf");
};

let pluginHostModulesPromise: Promise<PluginHostModules> | undefined;

/**
 * Resolve optional, heavy plugin peers only when a plugin is actually loaded.
 * Keeping molplot/Vega, the stage barrel, and the glTF exporter subpath out of
 * this module's static graph saves the normal viewer startup path while
 * preserving a single shared instance for plugins.
 */
export function getPluginHostModules(): Promise<PluginHostModules> {
  pluginHostModulesPromise ??= Promise.all([
    import("@molcrafts/molplot"),
    import("@molcrafts/molvis-stage"),
    import("@molcrafts/molvis-stage/export-gltf"),
  ]).then(([Molplot, MolvisStage, MolvisStageExportGltf]) => ({
    ...eagerPluginHostModules,
    "@molcrafts/molplot": Molplot,
    "@molcrafts/molvis-stage": MolvisStage,
    "@molcrafts/molvis-stage/export-gltf": MolvisStageExportGltf,
  }));
  return pluginHostModulesPromise;
}
