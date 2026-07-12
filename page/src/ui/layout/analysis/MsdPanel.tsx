import { LineChart, type SeriesPoint } from "@molcrafts/molplot";
import {
  computeMsdTrajectory,
  type FrameRange,
  type Molvis,
  type MsdTrajectoryResult,
} from "@molvis/core";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { AnalysisAlert } from "./AnalysisAlert";
import { AnalysisPanelShell } from "./AnalysisPanelShell";
import { AnalysisRunBar } from "./AnalysisRunBar";
import { ParamStack } from "./ParamStack";
import { ResultSection } from "./ResultSection";
import {
  ALL_ATOMS_OPTION_ID,
  collectAtomSelectionOptions,
  type ModifierOption,
  type SelectionOptionMap,
} from "./selectionOptions";

function MsdChart({ result }: { result: MsdTrajectoryResult }) {
  const [plotDiv, setPlotDiv] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const div = plotDiv;
    if (!div) return;
    const points: SeriesPoint[] = result.result.frames.map((frame, i) => ({
      x: result.frameIndices[i],
      y: frame.mean,
    }));
    const chart = new LineChart(div, {
      series: [
        { id: "msd", label: "MSD", initialPoints: points, mode: "lines" },
      ],
      xAxis: { label: "Frame", rangemode: "tozero" },
      yAxis: { label: "MSD (Å²)", rangemode: "tozero" },
    });
    return () => {
      chart.dispose();
    };
  }, [plotDiv, result]);

  return <div ref={setPlotDiv} className="h-44 w-full min-h-40" />;
}

function downloadMsdCsv(result: MsdTrajectoryResult) {
  const lines = ["frame,msd"];
  for (let i = 0; i < result.result.frames.length; i++) {
    lines.push(`${result.frameIndices[i]},${result.result.frames[i].mean}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "msd.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function MsdPanel({
  app,
  frameRange,
  trajectoryLength,
  children,
}: {
  app: Molvis | null;
  frameRange: FrameRange;
  trajectoryLength: number;
  children?: React.ReactNode;
}) {
  const [modifiers, setModifiers] = useState<ModifierOption[]>([]);
  const [selectionId, setSelectionId] = useState(ALL_ATOMS_OPTION_ID);
  const [result, setResult] = useState<MsdTrajectoryResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const selectionsRef = useRef<SelectionOptionMap>(new Map());

  const paramsKey = useMemo(
    () => JSON.stringify({ selectionId, frameRange }),
    [selectionId, frameRange],
  );
  const stale =
    result !== null && resultKey !== null && resultKey !== paramsKey;

  useEffect(() => {
    if (!app) return;
    const update = () => {
      const { options, selections } = collectAtomSelectionOptions(app);
      selectionsRef.current = selections;
      setModifiers(options);
      if (!options.some((option) => option.id === selectionId)) {
        setSelectionId(options[0]?.id ?? ALL_ATOMS_OPTION_ID);
      }
    };
    const unsub1 = app.modifierPipeline.on("computed", update);
    const unsub2 = app.modifierPipeline.on("modifier-added", update);
    const unsub3 = app.modifierPipeline.on("modifier-removed", update);
    const unsub4 = app.world.selectionManager.on("selection-change", update);
    const unsub5 = app.events.on("frame-change", update);
    update();
    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      unsub5();
    };
  }, [app, selectionId]);

  const handleCompute = useCallback(() => {
    if (!app) return;
    const selection = selectionsRef.current.get(selectionId);
    if (!selection) {
      setError("Atom selection not found.");
      return;
    }
    setComputing(true);
    setProgress(null);
    setError(null);
    requestAnimationFrame(() => {
      void (async () => {
        try {
          const next = await computeMsdTrajectory(
            app.system.trajectory,
            {
              selection,
            },
            {
              frameRange,
              onProgress: ({ completed, total }) =>
                setProgress({ completed, total }),
            },
          );
          if (!next) {
            setError("MSD needs at least two valid frames.");
          } else {
            setResult(next);
            setResultKey(paramsKey);
          }
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "MSD computation failed",
          );
        } finally {
          setComputing(false);
        }
      })();
    });
  }, [app, selectionId, frameRange, paramsKey]);

  const computeDisabled = computing || trajectoryLength < 2;

  return (
    <AnalysisPanelShell
      footer={
        <AnalysisRunBar
          onRun={handleCompute}
          running={computing}
          progress={progress}
          disabled={computeDisabled}
          label="Compute MSD"
          summary={
            trajectoryLength < 2
              ? "Needs at least 2 frames"
              : `${trajectoryLength} frames available`
          }
        />
      }
    >
      {children}
      <SidebarSection
        title="MSD"
        subtitle={`${trajectoryLength} frame${trajectoryLength === 1 ? "" : "s"} available`}
        defaultOpen={true}
      >
        <ParamStack label="Atoms">
          <Select value={selectionId} onValueChange={setSelectionId}>
            <SelectTrigger className="h-7 w-full min-w-0 px-2 text-xs">
              <SelectValue placeholder="Choose atoms" />
            </SelectTrigger>
            <SelectContent>
              {modifiers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="text-xs">
                    {m.label}
                    <span className="ml-1 text-muted-foreground">
                      ({m.count})
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ParamStack>

        {error && <AnalysisAlert tone="error">{error}</AnalysisAlert>}
      </SidebarSection>

      {!result && !computing && (
        <EmptyState
          density="compact"
          title="No MSD yet"
          description="Pick atoms and run mean-squared displacement over the scope."
        />
      )}

      {result && (
        <ResultSection
          subtitle={`${result.frameIndices.length} sampled frames`}
          stale={stale}
          onExport={() => downloadMsdCsv(result)}
          failures={result.failures.length}
        >
          <MsdChart result={result} />
        </ResultSection>
      )}
    </AnalysisPanelShell>
  );
}
