import { BarChart, type BarPoint } from "@molcrafts/molplot";
import {
  detectRings,
  type Molvis,
  type RingInfo,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { AnalysisAlert } from "./AnalysisAlert";
import { AnalysisChart } from "./AnalysisChart";
import { AnalysisPanelShell } from "./AnalysisPanelShell";
import { AnalysisRunBar } from "./AnalysisRunBar";
import { ResultSection } from "./ResultSection";

/** Product compute id — not a molrs catalog key; injected in useAnalysisCatalog. */
export const RINGS_ANALYSIS_ID = "topology.rings";

interface RingsPanelProps {
  app: Molvis | null;
}

function sizeHistogram(info: RingInfo): BarPoint[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < info.ringSizes.length; i++) {
    const s = info.ringSizes[i];
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([size, count]) => ({
      x: size,
      y: count,
      text: `${count} ring${count === 1 ? "" : "s"} of size ${size}`,
    }));
}

function RingSizeChart({ info }: { info: RingInfo }) {
  const controller = useMemo(() => {
    const points = sizeHistogram(info);
    return {
      mount: (el: HTMLElement) => {
        if (points.length === 0) {
          return {
            ready: () => Promise.resolve(),
            dispose: () => undefined,
          };
        }
        const chart = new BarChart(el, {
          series: [{ id: "rings", label: "rings", points }],
          orientation: "v",
          xAxis: { label: "ring size", dtype: "category" },
          yAxis: { label: "count", rangemode: "tozero" },
          showLegend: false,
        });
        return {
          ready: async () => {
            await chart.ready();
          },
          dispose: () => chart.dispose(),
        };
      },
    };
  }, [info]);

  return (
    <AnalysisChart
      controller={controller}
      chartKey={`${info.numRings}-${info.atomRingMask.length}`}
      title="Ring sizes"
    />
  );
}

/**
 * SSSR ring detection (Topology.findRings) — first-class Compute entry.
 * Chart-only + select-by-mask; not a pipeline modifier.
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
      const bonds = frame.getBlock("bonds");
      if (!bonds || bonds.nrows() === 0) {
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
        <p className="text-micro text-muted-foreground">
          Smallest-set-of-smallest-rings on the bond graph. Chart-only — not a
          pipeline modifier.
        </p>
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
            <RingSizeChart info={result} />
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
