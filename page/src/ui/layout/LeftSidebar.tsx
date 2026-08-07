import {
  type AnalysisAtomSelection,
  getAnalysisDefinition,
  type Molvis,
  type PipelineEntry,
} from "@molcrafts/molvis-stage";
import { ArrowLeft, Database } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { ViewerOperationState } from "@/components/viewer/ViewerOperationState";
import { useSelectedAtoms } from "@/hooks/useSelectedAtoms";
import { resolveModifierPanel } from "@/plugins";
import {
  getPluginAnalysisSpec,
  isPluginAnalysisId,
  pluginSpecToDefinition,
} from "@/plugins/analysis_catalog";
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
import { PluginAnalysisPanel } from "./analysis/PluginAnalysisPanel";
import { RdfPanel } from "./analysis/RdfPanel";
import { useAnalysisCatalog } from "./analysis/useAnalysisCatalog";
import { useTrajectoryLength } from "./analysis/useAnalysisHooks";
import { ClusterPanel } from "./ClusterPanel";
import { useLeftShellOptional } from "./LeftShellContext";
import { PCATool } from "./PCATool";
import { StructureOptimizePanel } from "./StructureOptimizePanel";

interface LeftSidebarProps {
  app: Molvis | null;
  headerAction?: React.ReactNode;
}

type AdvancedFeature = "analysis" | "optimize";

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

/** Left-panel advanced tools — extend this list as new features land. */
const FEATURES: Array<{ value: AdvancedFeature; label: string }> = [
  { value: "analysis", label: "Analysis" },
  { value: "optimize", label: "Optimization" },
];

/** Borderless trigger for toolbar menus (no outline frame). */
const MENU_TRIGGER =
  "min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none hover:bg-interactive focus-visible:border-0 focus-visible:ring-0";

/** Prevent pointer events from leaking to the BabylonJS canvas. */
const stopPointerPropagation = (e: React.PointerEvent) => {
  e.stopPropagation();
};

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  app,
  headerAction,
}) => {
  const leftShell = useLeftShellOptional();
  const [feature, setFeature] = useState<AdvancedFeature>("analysis");
  const [analysisType, setAnalysisType] = useState<string>(DEFAULT_ANALYSIS_ID);
  const [scope, setScope] = useState<ScopeState>(DEFAULT_SCOPE);
  const [sceneDirty, setSceneDirty] = useState(
    () => app?.world.sceneIndex.hasUnsavedChanges ?? false,
  );
  // Bump when pipeline mutates so left config re-resolves the modifier.
  const [pipelineTick, setPipelineTick] = useState(0);
  const trajectoryLength = useTrajectoryLength(app);
  const selectedAtoms = useSelectedAtoms(app);
  const catalog = useAnalysisCatalog(app, selectedAtoms.length > 0);
  const isPluginAnalysis = isPluginAnalysisId(analysisType);

  useEffect(() => {
    if (!app) return;
    const bump = () => setPipelineTick((t) => t + 1);
    const p = app.modifierPipeline;
    p.on("computed", bump);
    p.on("entry-added", bump);
    p.on("entry-removed", bump);
    return () => {
      p.off("computed", bump);
      p.off("entry-added", bump);
      p.off("entry-removed", bump);
    };
  }, [app]);

  // Sync local feature tabs when shell mode is driven from pipeline selection.
  useEffect(() => {
    if (!leftShell) return;
    if (leftShell.mode === "optimize") setFeature("optimize");
    if (leftShell.mode === "analysis") setFeature("analysis");
  }, [leftShell, leftShell?.mode]);

  const configModifier: PipelineEntry | null = useMemo(() => {
    // pipelineTick invalidates when modifiers mutate in place without id change.
    void pipelineTick;
    if (!app || !leftShell || leftShell.mode !== "modifier-config") return null;
    if (!leftShell.modifierId) return null;
    return (
      app.modifierPipeline
        .getEntries()
        .find((m) => m.id === leftShell.modifierId) ?? null
    );
  }, [app, leftShell, leftShell?.mode, leftShell?.modifierId, pipelineTick]);

  const handleLeftConfigUpdate = useCallback(() => {
    setPipelineTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!app) {
      setSceneDirty(false);
      return;
    }
    setSceneDirty(app.world.sceneIndex.hasUnsavedChanges);
    return app.events.on("dirty-change", (isDirty) => {
      setSceneDirty(isDirty);
    });
  }, [app]);

  const selectedAnalysis = useMemo(() => {
    if (isPluginAnalysis) {
      const spec = getPluginAnalysisSpec(analysisType);
      return spec ? pluginSpecToDefinition(spec) : undefined;
    }
    return getAnalysisDefinition(analysisType);
  }, [analysisType, isPluginAnalysis]);
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
    if (!hasData || catalog.probing || catalog.error) return;
    const entries = catalog.groups.flatMap((g) => g.entries);
    const current = entries.find((e) => e.analysis.id === analysisType);
    if (current && !current.blockedReason) return;
    const firstRunnable = entries.find((e) => !e.blockedReason);
    if (firstRunnable) setAnalysisType(firstRunnable.analysis.id);
  }, [hasData, catalog.probing, catalog.error, catalog.groups, analysisType]);

  const blockedReason = catalog.groups
    .flatMap((group) => group.entries)
    .find((entry) => entry.analysis.id === analysisType)?.blockedReason;

  // Frame scope only for multi-frame trajectories; single frames use defaults.
  const scopeNode =
    trajectoryLength > 1 ? (
      <AnalysisScope
        value={scope}
        onChange={setScope}
        trajectoryLength={trajectoryLength}
        selectedAtomCount={selectedAtoms.length}
        hideAtomScope={hideAtomScope}
      />
    ) : null;

  const analysisBody = catalog.error ? (
    <div className="flex min-h-0 flex-1 items-start justify-center p-2">
      <ViewerOperationState
        phase="error"
        message="Could not check analysis requirements"
        detail={catalog.error}
        action={
          <ViewerAction purpose="dismiss" onClick={catalog.retry}>
            Retry
          </ViewerAction>
        }
      />
    </div>
  ) : catalog.probing ? (
    <div className="flex min-h-0 flex-1 items-start justify-center p-2">
      <ViewerOperationState
        phase="loading"
        message="Checking loaded data…"
        detail="Probing analysis requirements against the current frame."
      />
    </div>
  ) : sceneDirty ? (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex min-h-0 flex-1 flex-col"
    >
      <EmptyState
        density="compact"
        className="min-h-0 flex-1 justify-center"
        icon={<Database className="h-8 w-8" />}
        title="Save scene before analysis"
        description="Unsaved canvas edits are not yet in the committed structure. Analysis only reads the committed frame — use the top Save button or Ctrl+S / ⌘S (any mode)."
        action={
          app ? (
            <ViewerAction
              purpose="commit"
              onClick={() => {
                app.commitScene();
              }}
            >
              Commit scene
            </ViewerAction>
          ) : undefined
        }
      />
    </div>
  ) : !hasData ? (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex min-h-0 flex-1"
    >
      <EmptyState
        density="compact"
        className="min-h-0 flex-1 justify-center"
        icon={<Database className="h-8 w-8" />}
        title="No structure loaded"
        description="Load a structure or trajectory, or draw in Edit then Save (toolbar / Ctrl+S). Requirements are checked from the committed frame."
      />
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col">
      <span role="status" aria-live="polite" className="sr-only">
        Analysis requirements ready
      </span>
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
      {analysisType === "ml.pca" && <PCATool app={app}>{scopeNode}</PCATool>}
      {isPluginAnalysis && (
        <PluginAnalysisPanel
          app={app}
          analysisId={analysisType}
          scopeSummary={scopeSummary}
        >
          {scopeNode}
        </PluginAnalysisPanel>
      )}
      {selectedAnalysis &&
        !isPluginAnalysis &&
        !PANEL_ANALYSIS_IDS.has(analysisType) && (
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
  );

  const ConfigPanel = configModifier
    ? resolveModifierPanel(configModifier)
    : null;
  const showModifierConfig =
    leftShell?.mode === "modifier-config" && configModifier !== null;

  return (
    <section
      aria-label="Advanced tools"
      className="flex h-full w-full flex-col bg-background"
      onPointerDown={stopPointerPropagation}
    >
      <div className="z-20 flex h-7 shrink-0 items-center gap-1 px-1">
        {showModifierConfig ? (
          <>
            <ViewerIconAction
              icon={<ArrowLeft />}
              label="Back to analysis"
              tooltipSide="bottom"
              onClick={() => leftShell?.closeLeftToAnalysis()}
              className="shrink-0"
            />
            <span className="min-w-0 flex-1 truncate px-1 text-xs font-normal">
              {configModifier.name}
            </span>
          </>
        ) : (
          <Select
            value={feature}
            onValueChange={(v) => {
              const next = v as AdvancedFeature;
              setFeature(next);
              if (next === "analysis") leftShell?.setAnalysisMode();
              if (next === "optimize") leftShell?.setOptimizeMode();
            }}
          >
            <SelectTrigger
              size="sm"
              className={MENU_TRIGGER}
              aria-label="Advanced tool"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-0 shadow-overlay">
              {FEATURES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {headerAction}
      </div>

      {showModifierConfig && (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {ConfigPanel ? (
              <ConfigPanel
                modifier={configModifier}
                app={app}
                onUpdate={handleLeftConfigUpdate}
                surface="compute"
              />
            ) : (
              <p className="text-micro text-muted-foreground text-center p-3">
                No configuration panel for {configModifier.name}.
              </p>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Keep both mounted so params/results survive feature switches. */}
      <div
        className={
          !showModifierConfig && feature === "analysis"
            ? "flex min-h-0 flex-1 flex-col"
            : "hidden"
        }
        aria-hidden={showModifierConfig || feature !== "analysis"}
      >
        <div className="z-10 flex h-7 shrink-0 items-center gap-1 px-1">
          <AnalysisPicker
            groups={catalog.groups}
            selected={hasData ? selectedAnalysis : undefined}
            onSelect={setAnalysisType}
            showBlockedReasons={hasData}
            enabled={hasData && !catalog.probing && !catalog.error}
            probing={catalog.probing}
            borderless
          />
        </div>
        {analysisBody}
      </div>

      <div
        className={
          !showModifierConfig && feature === "optimize"
            ? "flex min-h-0 flex-1 flex-col"
            : "hidden"
        }
        aria-hidden={showModifierConfig || feature !== "optimize"}
      >
        <StructureOptimizePanel app={app} />
      </div>
    </section>
  );
};
