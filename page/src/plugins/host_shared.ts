/**
 * Shared host modules for plugin import-map injection.
 *
 * The specifier list is {@link PluginHostModuleId} in
 * `@molcrafts/molvis-plugin`. This map must inject every id on that list, and
 * nothing else — `satisfies` below enforces both directions at compile time,
 * so the two can no longer drift apart silently.
 *
 * Stage and molplot are resolved lazily: a static `import * as Stage` of the
 * stage barrel would pin every re-export (RDF/MSD kernels, L-BFGS, glTF)
 * into the viewer startup graph.
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
type LazyHostModuleId = "@molcrafts/molplot" | "@molcrafts/molvis-stage";
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
};

let pluginHostModulesPromise: Promise<PluginHostModules> | undefined;

/**
 * Resolve optional, heavy plugin peers only when a plugin is actually loaded.
 * Keeping molplot/Vega and the stage barrel out of this module's static graph
 * saves the normal viewer startup path while preserving a single shared
 * instance for plugins.
 */
export function getPluginHostModules(): Promise<PluginHostModules> {
  pluginHostModulesPromise ??= Promise.all([
    import("@molcrafts/molplot"),
    import("@molcrafts/molvis-stage"),
  ]).then(([Molplot, MolvisStage]) => ({
    ...eagerPluginHostModules,
    "@molcrafts/molplot": Molplot,
    "@molcrafts/molvis-stage": MolvisStage,
  }));
  return pluginHostModulesPromise;
}
