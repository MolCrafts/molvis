import { LineChart, type SeriesPoint } from "@molcrafts/molplot";
import {
  type AnalysisFrameSnapshot,
  expandFrameRange,
  type FrameRange,
  type Molvis,
  type MsdTrajectoryResult,
  runAnalysisOnWorker,
  snapshotFrameForAnalysis,
  warmComputeWorker,
} from "@molcrafts/molvis-stage";
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
import { AnalysisAlert } from "./AnalysisAlert";
import { AnalysisChart, type AnalysisChartController } from "./AnalysisChart";
import { AnalysisPanelShell } from "./AnalysisPanelShell";
import { AnalysisRunBar } from "./AnalysisRunBar";
import { ParamStack } from "./ParamStack";
import { ResultSection } from "./ResultSection";
import {
  ALL_ATOMS_OPTION_ID,
  collectAtomSelectionOptions,
  type ModifierOption,
  type SelectionOptionMap,
  wireAtomSelection,
} from "./selectionOptions";

/** Catalog key of the MSD analysis (molrs compute catalog). */
const MSD_ANALYSIS_ID = "msd.mean_squared_displacement";

function MsdChart({ result }: { result: MsdTrajectoryResult }) {
  const controller = useMemo<AnalysisChartController>(() => {
    const points: SeriesPoint[] = result.result.frames.map((frame, i) => ({
      x: result.frameIndices[i],
      y: frame.mean,
    }));
    return {
      mount: (el) => {
        const chart = new LineChart(el, {
          series: [
            { id: "msd", label: "MSD", initialPoints: points, mode: "lines" },
          ],
          xAxis: { label: "Frame", rangemode: "tozero" },
          yAxis: { label: "MSD (Å²)", rangemode: "tozero" },
          showLegend: true,
        });
        return {
          ready: async () => {
            await chart.ready();
          },
          dispose: () => chart.dispose(),
        };
      },
    };
  }, [result]);

  return (
    <AnalysisChart
      controller={controller}
      chartKey={result.frameIndices.join(",")}
      title="MSD"
    />
  );
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
  /** Shared frame-scope control; rendered in the pinned footer, above Run. */
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
  /** Polled by the worker host between frames; reset on every run. */
  const cancelRef = useRef(false);

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
    const unsub2 = app.modifierPipeline.on("entry-added", update);
    const unsub3 = app.modifierPipeline.on("entry-removed", update);
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

  // Lazy-start the shared compute worker when this panel is shown, so the first
  // Run does not also pay worker boot + molrs WASM load.
  useEffect(() => {
    if (!app) return;
    void warmComputeWorker().catch(() => {
      /* first Run will surface the error */
    });
  }, [app]);

  const handleCompute = useCallback(() => {
    if (!app) return;
    const selection = selectionsRef.current.get(selectionId);
    if (!selection) {
      setError("Atom selection not found.");
      return;
    }
    // A live SelectionMask cannot cross postMessage — resolve the group against
    // the current frame.
    const wireSelection = wireAtomSelection(selection);

    setComputing(true);
    setProgress(null);
    setError(null);
    cancelRef.current = false;
    requestAnimationFrame(() => {
      void (async () => {
        try {
          const trajectory = app.system.trajectory;
          // The job materializes every selected frame up front; the buffers are
          // transferred to the worker rather than copied, and the frame range is
          // what bounds the cost.
          const frames: AnalysisFrameSnapshot[] = [];
          for (const index of expandFrameRange(trajectory.length, frameRange)) {
            // The trajectory owns its frames — snapshot, never free.
            const frame = await trajectory.frame(index);
            frames.push(snapshotFrameForAnalysis(frame, index));
          }
          if (frames.length < 2) {
            setError("MSD needs at least two valid frames.");
            return;
          }

          const outcome = await runAnalysisOnWorker(
            {
              analysisId: MSD_ANALYSIS_ID,
              params: { selection: wireSelection },
              frames,
            },
            {
              onProgress: (p) => {
                if (p.kind === "frame") {
                  setProgress({ completed: p.completed, total: p.total });
                }
              },
              shouldCancel: () => cancelRef.current,
            },
          );

          if (outcome.cancelled) {
            // Not a result: leave the chart and its stale key exactly as they
            // were, so a cancel never reads as a fresh update.
            app.events.emit("status-message", {
              text: "MSD cancelled",
              type: "info",
            });
          } else if (outcome.payload === null) {
            setError("MSD needs at least two valid frames.");
          } else {
            setResult(outcome.payload as MsdTrajectoryResult);
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

  /** Cooperative: the worker stops at its next frame checkpoint. */
  const handleCancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const computeDisabled = computing || trajectoryLength < 2;

  return (
    <AnalysisPanelShell
      footer={
        <AnalysisRunBar
          scope={children}
          onRun={handleCompute}
          onCancel={handleCancel}
          running={computing}
          progress={progress}
          disabled={computeDisabled}
          label="Compute MSD"
          summary={
            trajectoryLength < 2
              ? "Needs at least 2 frames"
              : `${trajectoryLength} frames`
          }
        />
      }
    >
      <div className="flex flex-col gap-2 p-2">
        <ParamStack label="Atoms">
          <Select value={selectionId} onValueChange={setSelectionId}>
            <SelectTrigger
              aria-label="MSD atom selection"
              className="h-control-compact w-full min-w-0 px-2 text-xs"
            >
              <SelectValue placeholder="Atoms" />
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
      </div>

      {!result && !computing && (
        <EmptyState density="compact" title="No MSD yet" />
      )}

      {result && (
        <ResultSection
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
