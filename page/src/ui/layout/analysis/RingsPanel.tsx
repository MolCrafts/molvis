import {
  detectRings,
  type Molvis,
  type RingInfo,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { DocsLink } from "@/components/viewer/DocsLink";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { molpyDocsForAnalysis } from "@/lib/molpy-docs";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { AnalysisAlert } from "./AnalysisAlert";
import { AnalysisPanelShell } from "./AnalysisPanelShell";
import { AnalysisRunBar } from "./AnalysisRunBar";
import { ResultSection } from "./ResultSection";

/** Product compute id — not a molrs catalog key; injected in useAnalysisCatalog. */
export const RINGS_ANALYSIS_ID = "topology.rings";

interface RingsPanelProps {
  app: Molvis | null;
}

/**
 * SSSR ring detection (molrs `assignRings`) — first-class Compute entry.
 * Ring count + select-by-mask; not a pipeline modifier.
 *
 * No frame scope: detection reads the current frame's bond graph.
 */
export const RingsPanel: React.FC<RingsPanelProps> = ({ app }) => {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyTitle, setEmptyTitle] = useState<string | null>(null);
  const [result, setResult] = useState<RingInfo | null>(null);

  const handleRun = useCallback(() => {
    if (!app) return;
    const frame = app.system.frame;
    if (!frame) {
      setError("No frame loaded.");
      return;
    }
    setRunning(true);
    setError(null);
    setEmptyTitle(null);
    try {
      const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
      if (!bonds || bonds.nRows === 0) {
        setResult(null);
        setEmptyTitle("No bonds");
        return;
      }
      const info = detectRings(frame);
      if (!info) {
        setResult(null);
        setEmptyTitle("No rings");
        return;
      }
      if (info.numRings === 0) {
        setResult(info);
        setEmptyTitle("No rings");
        return;
      }
      setResult(info);
      setEmptyTitle(null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Ring detection failed");
    } finally {
      setRunning(false);
    }
  }, [app]);

  const selectRingAtoms = useCallback(() => {
    if (!app || !result) return;
    const atoms: number[] = [];
    for (let i = 0; i < result.atomRingMask.length; i++) {
      if (result.atomRingMask[i]) atoms.push(i);
    }
    app.world.selectionManager.apply({ type: "replace", atoms });
  }, [app, result]);

  const ringAtomCount = useMemo(() => {
    if (!result) return 0;
    let n = 0;
    for (let i = 0; i < result.atomRingMask.length; i++) {
      if (result.atomRingMask[i]) n++;
    }
    return n;
  }, [result]);

  const hasPositiveRings = (result?.numRings ?? 0) > 0;

  return (
    <AnalysisPanelShell
      footer={
        <AnalysisRunBar
          onRun={handleRun}
          running={running}
          disabled={running || !app}
          label="Detect rings"
          summary="SSSR (topology)"
        />
      }
    >
      <SidebarSection title="Rings" subtitle="SSSR" defaultOpen>
        <DocsLink href={molpyDocsForAnalysis(RINGS_ANALYSIS_ID)}>
          Topology · molpy handbook
        </DocsLink>
      </SidebarSection>

      {error ? <AnalysisAlert tone="error">{error}</AnalysisAlert> : null}

      {emptyTitle && !hasPositiveRings ? (
        <EmptyState density="compact" title={emptyTitle} />
      ) : null}

      {hasPositiveRings && result ? (
        <ResultSection>
          <div className="flex flex-col gap-2">
            <p className="text-micro text-muted-foreground tabular-nums">
              {result.numRings} ring{result.numRings === 1 ? "" : "s"} ·{" "}
              {ringAtomCount} atom{ringAtomCount === 1 ? "" : "s"} in rings
            </p>
            <ViewerAction
              onClick={selectRingAtoms}
              disabled={ringAtomCount === 0}
              className="w-full"
            >
              Select ring atoms
            </ViewerAction>
          </div>
        </ResultSection>
      ) : null}
    </AnalysisPanelShell>
  );
};
