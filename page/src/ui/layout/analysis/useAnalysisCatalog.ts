import {
  type AnalysisDefinition,
  analysisAvailability,
  frameHasStructure,
  listAnalysisCategoriesWithEntries,
  type Molvis,
  structureProbeKey,
} from "@molcrafts/molvis-stage";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listPluginAnalysisSpecs,
  PLUGIN_ANALYSIS_CATEGORY,
  pluginSpecToDefinition,
  subscribePluginAnalyses,
} from "@/plugins/analysis_catalog";
import type { PickerGroup } from "./AnalysisPicker";
import { RINGS_ANALYSIS_ID } from "./RingsPanel";

export interface AnalysisCatalogState {
  /** Picker groups with blocked reasons derived from the current frame. */
  groups: PickerGroup[];
  /** True while a probe pass is scheduled or running. */
  probing: boolean;
  /** Non-empty atoms block present on the current frame. */
  hasData: boolean;
  /** Last structure key that produced `groups` (for debug / tests). */
  probeKey: string;
  /** Probe failure detail, if the most recent pass failed. */
  error: string | null;
  /** Re-run the current probe after a failure. */
  retry: () => void;
}

type AnalysisCatalogSnapshot = Omit<AnalysisCatalogState, "retry">;

const EMPTY: AnalysisCatalogSnapshot = {
  groups: [],
  probing: false,
  hasData: false,
  probeKey: "empty|sel=0",
  error: null,
};

/**
 * Product-facing labels that supersede the raw molrs catalog names.
 * Keep ids stable (dispatch / panel routing); only the display string changes.
 */
const ANALYSIS_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  "rdf.radial_distribution": "Pair distribution",
  "distribution.angle_distribution": "Bond angle distribution",
  "distribution.combined_distribution": "Bond distributions",
};

/** Product-only Compute entry (SSSR); not in molrs compute catalog. */
const RINGS_DEFINITION: AnalysisDefinition = {
  id: RINGS_ANALYSIS_ID,
  category: "topology",
  label: "Rings",
  wasmExport: "Topology",
  inputKind: "frame",
  resultKind: "barSeries",
  requires: [],
  params: [],
};

const TOPOLOGY_CATEGORY = { id: "topology", label: "Topology" };

function withDisplayLabel(analysis: AnalysisDefinition): AnalysisDefinition {
  const label = ANALYSIS_DISPLAY_LABELS[analysis.id];
  return label && label !== analysis.label ? { ...analysis, label } : analysis;
}

function buildGroups(
  app: Molvis,
  hasSelection: boolean,
): { groups: PickerGroup[]; hasData: boolean; probeKey: string } {
  const frame = app.system.frame;
  const context = { hasSelection };
  const hasData = frameHasStructure(frame);
  const probeKey = structureProbeKey(frame, context);
  const groups: PickerGroup[] = listAnalysisCategoriesWithEntries().map(
    ({ category, analyses }) => ({
      category,
      entries: analyses.map((analysis) => {
        const display = withDisplayLabel(analysis);
        const availability = analysisAvailability(frame, display, context);
        return {
          analysis: display,
          blockedReason: availability.runnable
            ? undefined
            : (availability.reason ?? "unavailable"),
        };
      }),
    }),
  );

  // Product Topology: Rings (SSSR) — first-class, not a molrs catalog id.
  groups.push({
    category: TOPOLOGY_CATEGORY,
    entries: [
      {
        analysis: RINGS_DEFINITION,
        blockedReason: hasData ? undefined : "Load a structure first",
      },
    ],
  });

  // Deep-merge plugin analyses into the same picker (own "Plugins" group).
  const pluginSpecs = listPluginAnalysisSpecs();
  if (pluginSpecs.length > 0) {
    groups.push({
      category: {
        id: PLUGIN_ANALYSIS_CATEGORY.id,
        label: PLUGIN_ANALYSIS_CATEGORY.label,
      },
      entries: pluginSpecs.map((spec) => ({
        analysis: pluginSpecToDefinition(spec),
        // Plugins decide applicability in run(); only require a structure.
        blockedReason: hasData ? undefined : "Load a structure first",
      })),
    });
  }

  return { groups, hasData, probeKey };
}

/**
 * Live analysis catalog: re-probes requirements whenever loaded data changes.
 *
 * Probing is **async** (yields to the event loop) so a large molrs catalog
 * does not block paint after a trajectory load. Events that only move the
 * camera / scrub to a topologically identical frame are coalesced via
 * {@link structureProbeKey}.
 */
export function useAnalysisCatalog(
  app: Molvis | null,
  hasSelection: boolean,
): AnalysisCatalogState {
  const [state, setState] = useState<AnalysisCatalogSnapshot>(EMPTY);
  const [retryNonce, setRetryNonce] = useState(0);
  const lastKeyRef = useRef<string>("");
  const generationRef = useRef(0);
  const retry = useCallback(() => {
    lastKeyRef.current = "";
    setRetryNonce((value) => value + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce is the explicit retry trigger for this scheduled probe.
  useEffect(() => {
    if (!app) {
      lastKeyRef.current = "";
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleProbe = () => {
      // Coalesce bursts (trajectory-change + frame-change + frame-load-end).
      if (timer !== null) clearTimeout(timer);
      setState((prev) => ({
        ...prev,
        probing: true,
        error: null,
      }));

      timer = setTimeout(() => {
        timer = null;
        const generation = ++generationRef.current;
        // Yield once more so React can paint the "probing" state first.
        void Promise.resolve().then(() => {
          if (cancelled || generation !== generationRef.current) return;

          try {
            const context = { hasSelection };
            const key = structureProbeKey(app.system.frame, context);
            if (key === lastKeyRef.current) {
              setState((prev) =>
                prev.probing ? { ...prev, probing: false } : prev,
              );
              return;
            }

            const next = buildGroups(app, hasSelection);
            if (cancelled || generation !== generationRef.current) return;
            lastKeyRef.current = next.probeKey;
            setState({
              groups: next.groups,
              hasData: next.hasData,
              probeKey: next.probeKey,
              probing: false,
              error: null,
            });
          } catch (error) {
            if (cancelled || generation !== generationRef.current) return;
            setState((prev) => ({
              ...prev,
              probing: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Compute requirements could not be checked",
            }));
          }
        });
      }, 0);
    };

    // Initial probe + re-run when the loaded structure / labels / selection
    // change. Playback with the same columns is a no-op thanks to the key.
    const forceProbe = () => {
      lastKeyRef.current = "";
      scheduleProbe();
    };
    scheduleProbe();
    const unsubs = [
      app.events.on("trajectory-change", scheduleProbe),
      app.events.on("frame-change", scheduleProbe),
      app.events.on("frame-load-end", scheduleProbe),
      app.events.on("frame-labels-change", scheduleProbe),
    ];
    // Bonds from ComputeBonds / pipeline rebuilds update the frame in place.
    const offComputed = app.modifierPipeline.on("computed", scheduleProbe);
    const offAdded = app.modifierPipeline.on("entry-added", scheduleProbe);
    const offRemoved = app.modifierPipeline.on("entry-removed", scheduleProbe);
    // Plugin activate/deactivate mutates the analysis contribution store.
    const offPlugins = subscribePluginAnalyses(forceProbe);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      for (const off of unsubs) off();
      offComputed();
      offAdded();
      offRemoved();
      offPlugins();
    };
  }, [app, hasSelection, retryNonce]);

  return { ...state, retry };
}
