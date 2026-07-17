import {
  type AnalysisAtomSelection,
  type AnalysisDefinition,
  type AnalysisParamValues,
  defaultAnalysisParams,
  type FrameRange,
  type Molvis,
  runAnalysis,
} from "@molvis/core";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Slider } from "@/components/ui/slider";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { AnalysisAlert } from "./AnalysisAlert";
import { AnalysisPanelShell } from "./AnalysisPanelShell";
import { AnalysisParamsForm } from "./AnalysisParamsForm";
import { AnalysisRunBar } from "./AnalysisRunBar";
import { InlineCode } from "./InlineCode";
import { ResultSection } from "./ResultSection";
import { ResultView } from "./ResultView";

/**
 * Drives any catalog analysis that has no bespoke panel: the parameter form is
 * generated from the analysis's schema, and the result is rendered by its
 * `resultKind`. Scope (frames, tracked atoms) arrives as props from the shared
 * scope region and never appears among the parameters.
 */

interface GenericAnalysisPanelProps {
  app: Molvis | null;
  definition: AnalysisDefinition;
  frameRange: FrameRange;
  selection: AnalysisAtomSelection;
  blockedReason?: string;
  /** One-line scope summary for the footer run bar. */
  scopeSummary?: string;
  /** Scope region rendered above parameters (scrolls with body). */
  children?: React.ReactNode;
}

interface RunState {
  status: "idle" | "running" | "done" | "error";
  payload?: unknown;
  perFrame?: boolean;
  frameIndices?: number[];
  failures?: number;
  message?: string;
}

function fingerprint(
  definitionId: string,
  params: AnalysisParamValues,
  frameRange: FrameRange,
  selection: AnalysisAtomSelection,
): string {
  return JSON.stringify({
    definitionId,
    params,
    frameRange,
    selection,
  });
}

export const GenericAnalysisPanel: React.FC<GenericAnalysisPanelProps> = ({
  app,
  definition,
  frameRange,
  selection,
  blockedReason,
  scopeSummary,
  children,
}) => {
  const [params, setParams] = useState<AnalysisParamValues>(() =>
    defaultAnalysisParams(definition),
  );
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [shownFrame, setShownFrame] = useState(0);
  const [resultFingerprint, setResultFingerprint] = useState<string | null>(
    null,
  );

  // A different analysis means different knobs and a stale result.
  useEffect(() => {
    setParams(defaultAnalysisParams(definition));
    setRun({ status: "idle" });
    setShownFrame(0);
    setResultFingerprint(null);
  }, [definition]);

  const currentFingerprint = useMemo(
    () => fingerprint(definition.id, params, frameRange, selection),
    [definition.id, params, frameRange, selection],
  );
  const stale =
    run.status === "done" &&
    resultFingerprint !== null &&
    resultFingerprint !== currentFingerprint;

  const execute = async () => {
    if (!app) return;
    setRun({ status: "running" });
    try {
      const result = await runAnalysis({
        definition,
        params,
        trajectory: app.system.trajectory,
        frameRange,
        selection,
      });
      setShownFrame(0);
      setResultFingerprint(currentFingerprint);
      setRun({
        status: "done",
        payload: result.payload,
        perFrame: result.perFrame,
        frameIndices: result.frameIndices,
        failures: result.failures.length,
      });
    } catch (error) {
      setRun({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const frames = run.frameIndices ?? [];
  const perFrameEntries = run.perFrame
    ? (run.payload as Array<{ frameIndex: number; value: unknown }> | undefined)
    : undefined;
  const shown = run.perFrame
    ? perFrameEntries?.[shownFrame]?.value
    : run.payload;

  return (
    <AnalysisPanelShell
      footer={
        <AnalysisRunBar
          onRun={() => void execute()}
          running={run.status === "running"}
          disabled={!app || blockedReason !== undefined}
          label={`Run ${definition.label}`}
          summary={scopeSummary}
          hint={
            blockedReason ? (
              <span>Fix requirements above to enable run.</span>
            ) : undefined
          }
        />
      }
    >
      {children}
      <SidebarSection title="Parameters" defaultOpen={true}>
        <AnalysisParamsForm
          params={definition.params}
          values={params}
          onChange={setParams}
          disabled={run.status === "running" || blockedReason !== undefined}
        />

        {blockedReason && (
          <AnalysisAlert tone="warning">
            <InlineCode text={blockedReason} />
          </AnalysisAlert>
        )}

        {run.status === "error" && (
          <AnalysisAlert tone="error">{run.message}</AnalysisAlert>
        )}
      </SidebarSection>

      {run.status === "idle" && !blockedReason && (
        <EmptyState
          density="compact"
          title="No result yet"
          description="Adjust scope and parameters, then run this analysis."
        />
      )}

      {run.status === "done" && (
        <ResultSection
          subtitle={`${frames.length} frame${frames.length === 1 ? "" : "s"}`}
          stale={stale}
          failures={run.failures ?? 0}
        >
          {run.perFrame && frames.length > 1 && (
            <div className="mb-1.5 flex items-center gap-2">
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                Frame {frames[shownFrame]}
              </span>
              <Slider
                min={0}
                max={frames.length - 1}
                step={1}
                value={[shownFrame]}
                onValueChange={(v) => setShownFrame(v[0] ?? 0)}
                className="min-w-0 flex-1"
                aria-label="Result frame"
              />
            </div>
          )}

          <ResultView
            resultKind={definition.resultKind}
            label={definition.label}
            payload={shown}
          />
        </ResultSection>
      )}
    </AnalysisPanelShell>
  );
};
