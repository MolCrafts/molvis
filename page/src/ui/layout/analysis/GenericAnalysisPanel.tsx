import {
  type AnalysisAtomSelection,
  type AnalysisDefinition,
  type AnalysisParamValues,
  computeClusterMaskProperties,
  defaultAnalysisParams,
  ensureCenterOfMassModifier,
  ensureRadiusOfGyrationModifier,
  type FrameRange,
  isComAnalysisId,
  isRgAnalysisId,
  type Molvis,
  readClusterMask,
  runAnalysis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Slider } from "@/components/ui/slider";
import { AnalysisAlert } from "./AnalysisAlert";
import { AnalysisPanelShell } from "./AnalysisPanelShell";
import { AnalysisParamsForm } from "./AnalysisParamsForm";
import { AnalysisRunBar } from "./AnalysisRunBar";
import { InlineCode } from "./InlineCode";
import { ResultSection } from "./ResultSection";
import { ResultView } from "./ResultView";

/**
 * Drives any catalog compute that has no bespoke panel: the parameter form is
 * generated from the compute's schema, and the result is rendered by its
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
      // COM / Rg: pipeline writes mask + draws; table uses the same mask compute.
      if (isComAnalysisId(definition.id) || isRgAnalysisId(definition.id)) {
        if (isComAnalysisId(definition.id)) {
          ensureCenterOfMassModifier(app);
        } else {
          ensureRadiusOfGyrationModifier(app);
        }
        await app.applyPipeline({ fullRebuild: true });
        const frame = app.system.frame;
        const resolved = frame ? readClusterMask(frame) : null;
        if (!frame || !resolved) {
          throw new Error(
            "No cluster_N column — Cluster modifier did not run.",
          );
        }
        const props = computeClusterMaskProperties(
          frame,
          resolved.mask,
          { useMassColumn: true },
          resolved.column,
        );
        if (!props) {
          throw new Error("Could not compute cluster properties from mask.");
        }
        const payload = isComAnalysisId(definition.id)
          ? {
              centersOfMass: props.centersOfMass,
              clusterMasses: props.clusterMasses,
              numClusters: props.numClusters,
              column: props.column,
            }
          : {
              radiiOfGyration: props.radiiOfGyration,
              centersOfMass: props.centersOfMass,
              numClusters: props.numClusters,
              column: props.column,
            };
        setShownFrame(0);
        setResultFingerprint(currentFingerprint);
        setRun({
          status: "done",
          payload,
          perFrame: false,
          frameIndices: undefined,
          failures: 0,
        });
        return;
      }

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
        <div className="shrink-0 space-y-2 border-t border-border/70 bg-background/95 px-2 py-2 backdrop-blur">
          {children}
          <AnalysisRunBar
            className="border-0 p-0"
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
        </div>
      }
    >
      <div className="flex flex-col gap-2 p-2">
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
      </div>

      {run.status === "idle" && !blockedReason && (
        <EmptyState
          density="compact"
          title="No result yet"
          description="Adjust scope and parameters, then run this analysis."
        />
      )}

      {run.status === "done" && (
        <ResultSection stale={stale} failures={run.failures ?? 0}>
          {run.perFrame && frames.length > 1 && (
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
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
