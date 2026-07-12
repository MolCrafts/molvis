import {
  type AnalysisAtomSelection,
  getAnalysisDefinition,
  type Molvis,
} from "@molvis/core";
import { Database, Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { AnalysisPicker } from "./analysis/AnalysisPicker";
import {
  AnalysisScope,
  DEFAULT_SCOPE,
  formatScopeSummary,
  parseScopeRange,
  type ScopeState,
} from "./analysis/AnalysisScope";
import { GenericAnalysisPanel } from "./analysis/GenericAnalysisPanel";
import { MsdPanel } from "./analysis/MsdPanel";
import { RdfPanel } from "./analysis/RdfPanel";
import { useAnalysisCatalog } from "./analysis/useAnalysisCatalog";
import {
  useSelectedAtoms,
  useTrajectoryLength,
} from "./analysis/useAnalysisHooks";
import { ClusterPanel } from "./ClusterPanel";
import { PCATool } from "./PCATool";

interface LeftSidebarProps {
  app: Molvis | null;
}

const DEFAULT_ANALYSIS_ID = "rdf.radial_distribution";

/**
 * Analyses with a bespoke panel. Everything else in the catalog is driven by
 * `GenericAnalysisPanel` from its schema — there is no "not implemented" tier.
 */
const PANEL_ANALYSIS_IDS = new Set<string>([
  "rdf.radial_distribution",
  "msd.mean_squared_displacement",
  "cluster.connected_components",
  "ml.pca",
]);

/** Analyses that pick their own atom groups — hide the shared atom scope toggle. */
const OWNS_ATOM_SCOPE = new Set<string>([
  "rdf.radial_distribution",
  "msd.mean_squared_displacement",
  "cluster.connected_components",
  "ml.pca",
]);

/** Prevent pointer events from leaking to the BabylonJS canvas. */
const stopPointerPropagation = (e: React.PointerEvent) => {
  e.stopPropagation();
};

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ app }) => {
  const [analysisType, setAnalysisType] = useState<string>(DEFAULT_ANALYSIS_ID);
  const [scope, setScope] = useState<ScopeState>(DEFAULT_SCOPE);
  const trajectoryLength = useTrajectoryLength(app);
  const selectedAtoms = useSelectedAtoms(app);
  const catalog = useAnalysisCatalog(app, selectedAtoms.length > 0);

  const selectedAnalysis = getAnalysisDefinition(analysisType);
  const frameRange = parseScopeRange(scope, trajectoryLength);
  const hideAtomScope = OWNS_ATOM_SCOPE.has(analysisType);
  const scopeSummary = formatScopeSummary(
    scope,
    trajectoryLength,
    selectedAtoms.length,
  );

  const atomSelection: AnalysisAtomSelection =
    scope.atoms === "selection" && selectedAtoms.length > 0
      ? { kind: "indices", indices: selectedAtoms }
      : { kind: "all" };

  const hasData = catalog.hasData;

  // If the current pick becomes blocked after a data change, jump to the first
  // runnable analysis so the panel is never stuck on an unavailable entry.
  useEffect(() => {
    if (!hasData || catalog.probing) return;
    const entries = catalog.groups.flatMap((g) => g.entries);
    const current = entries.find((e) => e.analysis.id === analysisType);
    if (current && !current.blockedReason) return;
    const firstRunnable = entries.find((e) => !e.blockedReason);
    if (firstRunnable) setAnalysisType(firstRunnable.analysis.id);
  }, [hasData, catalog.probing, catalog.groups, analysisType]);

  const blockedReason = catalog.groups
    .flatMap((group) => group.entries)
    .find((entry) => entry.analysis.id === analysisType)?.blockedReason;

  const scopeNode = (
    <AnalysisScope
      value={scope}
      onChange={setScope}
      trajectoryLength={trajectoryLength}
      selectedAtomCount={selectedAtoms.length}
      hideAtomScope={hideAtomScope}
    />
  );

  return (
    <div
      className="flex h-full w-full flex-col border-r border-border/70 bg-background"
      onPointerDown={stopPointerPropagation}
    >
      <div className="z-20 flex shrink-0 items-center gap-1.5 border-b border-border/70 bg-background/95 px-2 py-1.5 backdrop-blur">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Analysis
        </span>
        <AnalysisPicker
          groups={catalog.groups}
          selected={hasData ? selectedAnalysis : undefined}
          onSelect={setAnalysisType}
          showBlockedReasons={hasData}
          enabled={hasData && !catalog.probing}
          probing={catalog.probing}
        />
      </div>

      {!hasData ? (
        <EmptyState
          density="compact"
          className="min-h-0 flex-1 justify-center"
          icon={
            catalog.probing ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <Database className="h-8 w-8" />
            )
          }
          title={
            catalog.probing ? "Checking loaded data…" : "No structure loaded"
          }
          description={
            catalog.probing
              ? "Probing analysis requirements against the current frame."
              : "Load a structure or trajectory. Requirements are checked automatically from the loaded data."
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {analysisType === "rdf.radial_distribution" && (
            <RdfPanel
              app={app}
              frameRange={frameRange}
              trajectoryLength={trajectoryLength}
            >
              {scopeNode}
            </RdfPanel>
          )}
          {analysisType === "msd.mean_squared_displacement" && (
            <MsdPanel
              app={app}
              frameRange={frameRange}
              trajectoryLength={trajectoryLength}
            >
              {scopeNode}
            </MsdPanel>
          )}
          {analysisType === "cluster.connected_components" && (
            <ClusterPanel app={app}>{scopeNode}</ClusterPanel>
          )}
          {analysisType === "ml.pca" && (
            <PCATool app={app}>{scopeNode}</PCATool>
          )}
          {selectedAnalysis && !PANEL_ANALYSIS_IDS.has(analysisType) && (
            <GenericAnalysisPanel
              app={app}
              definition={selectedAnalysis}
              frameRange={frameRange}
              selection={atomSelection}
              blockedReason={blockedReason}
              scopeSummary={scopeSummary}
            >
              {scopeNode}
            </GenericAnalysisPanel>
          )}
        </div>
      )}
    </div>
  );
};
