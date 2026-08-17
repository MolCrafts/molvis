/**
 * Bridge plugin analysis specs into the left-sidebar AnalysisPicker catalog.
 */

import type {
  AnalysisDefinition,
  AnalysisParamKind,
  AnalysisParamSpec,
} from "@molcrafts/molvis-stage";
import { analysisStore } from "./contributions/ui";
import type { PluginAnalysisSpec } from "./types";

export const PLUGIN_ANALYSIS_CATEGORY = {
  id: "plugins",
  label: "Plugins",
} as const;

/** Map a plugin param kind onto the molrs AnalysisParamKind surface. */
function mapParamKind(kind: string): AnalysisParamKind {
  switch (kind) {
    case "int":
      return "int";
    case "float":
      return "float";
    case "bool":
      return "bool";
    case "select":
      return "select";
    case "text":
      return "textList";
    default:
      return "textList";
  }
}

/**
 * Synthesize an {@link AnalysisDefinition} so the picker / generic panel
 * machinery can display plugin analyses next to molrs catalog entries.
 *
 * `wasmExport` is intentionally empty — plugin runs never call molrs.
 */
export function pluginSpecToDefinition(
  spec: PluginAnalysisSpec,
): AnalysisDefinition {
  const params: AnalysisParamSpec[] = (spec.params ?? []).map((p) => {
    const kind = mapParamKind(p.kind);
    let defaultValue: number | boolean | string = "";
    if (p.default !== undefined && p.default !== null) {
      if (
        typeof p.default === "number" ||
        typeof p.default === "boolean" ||
        typeof p.default === "string"
      ) {
        defaultValue = p.default;
      } else {
        defaultValue = String(p.default);
      }
    } else if (kind === "bool") {
      defaultValue = false;
    } else if (kind === "int" || kind === "float") {
      defaultValue = 0;
    }

    return {
      key: p.name,
      label: p.label,
      kind,
      default: defaultValue,
      optional: true,
      slot: "ctor",
      min: p.min,
      max: p.max,
      options: p.options?.map((o) => o.value),
    };
  });

  const resultKind =
    spec.resultKind === "table"
      ? "table"
      : spec.resultKind === "scalar"
        ? "scalar"
        : "custom";

  return {
    id: spec.id,
    category: PLUGIN_ANALYSIS_CATEGORY.id,
    label: spec.label,
    wasmExport: "",
    inputKind: "frame",
    resultKind,
    requires: [],
    params,
  };
}

export function listPluginAnalysisSpecs(): PluginAnalysisSpec[] {
  return analysisStore.list();
}

export function getPluginAnalysisSpec(
  id: string,
): PluginAnalysisSpec | undefined {
  return analysisStore.get(id);
}

export function isPluginAnalysisId(id: string): boolean {
  return analysisStore.has(id) || id.startsWith("plugin.");
}

/** Subscribe to plugin analysis registry mutations. */
export function subscribePluginAnalyses(listener: () => void): () => void {
  return analysisStore.subscribe(listener);
}
