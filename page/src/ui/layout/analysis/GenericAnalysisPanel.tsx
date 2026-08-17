import {
  type AnalysisAtomSelection,
  type AnalysisDefinition,
  type AnalysisParamValues,
  type AnalysisShapeResult,
  computeClusterMaskProperties,
  defaultAnalysisParams,
  ensureCenterOfMassModifier,
  ensureRadiusOfGyrationModifier,
  type FrameRange,
  isComAnalysisId,
  type Molvis,
  readClusterMask,
  runAnalysis,
  runAnalysisOnWorker,
  snapshotFramesForAnalysis,
  type Trajectory,
  warmComputeWorker,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Slider } from "@/components/ui/slider";
import { DocsLink } from "@/components/viewer/DocsLink";
import { molpyDocsForAnalysis } from "@/lib/molpy-docs";
import { AnalysisAlert } from "./AnalysisAlert";
import { AnalysisPanelShell } from "./AnalysisPanelShell";
import { AnalysisParamsForm } from "./AnalysisParamsForm";
import { AnalysisRunBar } from "./AnalysisRunBar";
import { planAnalysisRun } from "./analysisRunPlan";
import { InlineCode } from "./InlineCode";
import { ResultSection } from "./ResultSection";
import { ResultView } from "./ResultView";
import { wireAtomSelection } from "./selectionOptions";

interface GenericAnalysisPanelProps {
  app: Molvis | null;
  definition: AnalysisDefinition;
  frameRange: FrameRange;
  selection: AnalysisAtomSelection;
  blockedReason?: string;
  /** One-line scope summary for the footer run bar. */
  scopeSummary?: string;
  /** Shared frame-scope control; rendered in the pinned footer, above Run. */
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

/**
 * The `pipeline` route: center of mass (COM, the mass-weighted average atom
 * position) and radius of gyration (Rg, how far a cluster's atoms spread around
 * that center).
 *
 * Not "run the analysis here" at all. `ensure*Modifier` installs two steps of
 * the pipeline — the chain that turns loaded frames into what the canvas draws:
 * a Cluster step, which labels every atom with the cluster it belongs to in a
 * `cluster_N` column (that integer-per-atom column is the "mask"), and the
 * Center of mass / Radius of gyration step that draws the result. The scene is
 * then rebuilt, and the table is computed from the mask on that very frame.
 *
 * Deliberately not a worker job even though a snapshot could carry it. A worker
 * would cluster its own copy of the frame a second time, so the panel's numbers
 * and the spheres on screen would come from two clusterings of one structure —
 * the Canvas WYSIWYG = SceneIndex invariant broken (WYSIWYG: "what you see is
 * what you get"; everything the user sees resolves against SceneIndex, molvis'
 * record of what is actually drawn). See `.claude/notes/canvas-sceneindex.md`;
 * kept on purpose by `.claude/specs/worker-catalog-dispatch-06-panels.md`.
 */
async function runPipelineRoute(
  app: Molvis,
  analysisId: string,
  signal: AbortSignal,
): Promise<RunState> {
  if (isComAnalysisId(analysisId)) {
    ensureCenterOfMassModifier(app);
  } else {
    ensureRadiusOfGyrationModifier(app);
  }
  await app.applyPipeline({ fullRebuild: true });
  if (signal.aborted) return { status: "idle" };
  const frame = app.system.frame;
  const resolved = frame ? readClusterMask(frame) : null;
  if (!frame || !resolved) {
    throw new Error("No cluster_N column — Cluster modifier did not run.");
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
  const payload = isComAnalysisId(analysisId)
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
  return {
    status: "done",
    payload,
    perFrame: false,
    frameIndices: undefined,
    failures: 0,
  };
}

/**
 * The `worker` route: a snapshot expresses this analysis, so its frames are
 * packed as plain data and submitted as one job to the shared compute worker —
 * the single background thread (a Web Worker) molvis runs long computations on,
 * so the tab keeps painting.
 *
 * Cancelling is a polled `shouldCancel` seam rather than the `AbortSignal` this
 * thread uses: an `AbortSignal` cannot cross `postMessage`, and a molrs call
 * already inside WebAssembly cannot be interrupted, so the worker asks the
 * question itself between frames. The panel's own `signal` never leaves this
 * thread; it is re-checked when the job comes back, so a run that was
 * superseded while in flight is discarded instead of shown.
 */
async function runWorkerRoute({
  analysisId,
  params,
  trajectory,
  frameRange,
  selection,
  signal,
  shouldCancel,
}: {
  analysisId: string;
  params: AnalysisParamValues;
  trajectory: Trajectory;
  frameRange: FrameRange;
  selection: AnalysisAtomSelection;
  signal: AbortSignal;
  /** Polled by the worker host between frames — Cancel, or a superseded run. */
  shouldCancel: () => boolean;
}): Promise<RunState> {
  // The trajectory owns its frames — snapshot, never free. The snapshot
  // buffers are transferred (not copied) when the job is posted, so this
  // payload is built for this one call and never read back.
  const frames = await snapshotFramesForAnalysis(trajectory, frameRange);
  const outcome = await runAnalysisOnWorker(
    {
      analysisId,
      // Scope is not a parameter: the atom group rides beside the catalog
      // params under the `selection` key the job reads. A live
      // `SelectionMask` cannot cross `postMessage`, hence the wire form.
      params: { ...params, selection: wireAtomSelection(selection) },
      frames,
    },
    {
      // Raised by Cancel, and by a superseded run (analysis switched, Run
      // clicked again) so the worker stops instead of finishing a result
      // nobody will read.
      shouldCancel,
    },
  );
  if (outcome.cancelled || signal.aborted) {
    // Not a result: leave the shown result and its fingerprint exactly as
    // they were, so a cancel never reads as a fresh run.
    return { status: "idle" };
  }
  // A snapshot-covered catalog analysis answers with the shape envelope —
  // the same per-frame / accumulate split `runAnalysis` reports. The two
  // trajectory-level entries answer their own result types instead, and never
  // reach this panel: RDF (radial distribution function) and MSD (mean squared
  // displacement) have bespoke panels, and `LeftSidebar`'s `PANEL_ANALYSIS_IDS`
  // routes them there before this component is mounted.
  const shape = outcome.payload as AnalysisShapeResult;
  return {
    status: "done",
    payload: shape.value,
    perFrame: shape.perFrame,
    frameIndices: shape.frameIndices,
    failures: shape.failures.length,
  };
}

/**
 * The `main` route: what an analysis job snapshot cannot carry runs here, on
 * this thread, against the live trajectory.
 *
 * Today that is the velocity-driven `series` shapes — VACF (velocity
 * autocorrelation function), Einstein diffusion, power spectrum — because a
 * snapshot carries no `vx` / `vy` / `vz` columns, plus `frameGroupSets`, whose
 * per-observable atom groups are UI state rather than frame data
 * ({@link planAnalysisRun} decides both). Nothing crosses a thread boundary on
 * this path, so `runAnalysis` reads the trajectory's molrs frames directly
 * instead of copying them; it is also public stage API, kept for that reason as
 * much as for this route.
 */
async function runMainRoute({
  definition,
  params,
  trajectory,
  frameRange,
  selection,
  signal,
}: {
  definition: AnalysisDefinition;
  params: AnalysisParamValues;
  trajectory: Trajectory;
  frameRange: FrameRange;
  selection: AnalysisAtomSelection;
  signal: AbortSignal;
}): Promise<RunState> {
  const result = await runAnalysis({
    definition,
    params,
    trajectory,
    frameRange,
    selection,
    abortSignal: signal,
  });
  if (signal.aborted) return { status: "idle" };
  return {
    status: "done",
    payload: result.payload,
    perFrame: result.perFrame,
    frameIndices: result.frameIndices,
    failures: result.failures.length,
  };
}

/**
 * The analysis panel for every catalog entry with no bespoke panel of its own:
 * the parameter form is generated from the entry's schema, and the result is
 * rendered by its `resultKind`. The *catalog* is the list of measurements
 * published by molrs, the Rust molecular core molvis computes with (compiled to
 * WebAssembly, the browser's binary code format). Scope — which frames, which
 * atoms — arrives as props from the shared scope region and never appears among
 * the parameters.
 *
 * Where a run goes is {@link planAnalysisRun}'s verdict, never a branch spelled
 * here: the modifier pipeline, the shared compute worker, or the main thread
 * ({@link runPipelineRoute}, {@link runWorkerRoute}, {@link runMainRoute}).
 * Whichever route a definition takes, it lands in the same {@link RunState}, so
 * the frame slider, the result view and the stale-result fingerprint do not
 * know which one ran.
 */
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
  /** This run is superseded — set when the analysis changes or Run repeats. */
  const abortRef = useRef<AbortController | null>(null);
  /** Polled by the worker host between frames; reset on every run. */
  const cancelRef = useRef(false);

  // A different analysis means different knobs and a stale result.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setParams(defaultAnalysisParams(definition));
    setRun({ status: "idle" });
    setShownFrame(0);
    setResultFingerprint(null);
  }, [definition]);

  // Lazy-start the shared compute worker when this panel is shown, so the first
  // worker-routed Run does not also pay worker boot + molrs WASM load.
  useEffect(() => {
    if (!app) return;
    void warmComputeWorker().catch(() => {
      /* first Run will surface the error */
    });
  }, [app]);

  const currentFingerprint = useMemo(
    () => fingerprint(definition.id, params, frameRange, selection),
    [definition.id, params, frameRange, selection],
  );
  const stale =
    run.status === "done" &&
    resultFingerprint !== null &&
    resultFingerprint !== currentFingerprint;

  /** Multi-frame / series-shaped runs get Cancel + series empty copy. */
  const isSeriesLike =
    definition.inputKind === "series" ||
    definition.inputKind === "accumulate" ||
    definition.resultKind === "trajectorySeries";

  const handleCancel = useCallback(() => {
    // Cooperative both ways: a worker job stops at its next frame checkpoint,
    // a main-thread run at its own abort check.
    cancelRef.current = true;
    abortRef.current?.abort();
  }, []);

  const execute = async () => {
    if (!app) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    cancelRef.current = false;
    setRun({ status: "running" });
    // One decision, taken in one place: `./analysisRunPlan` — including why the
    // pipeline route is checked before snapshot coverage, not after.
    const plan = planAnalysisRun(definition);
    try {
      const next =
        plan.route === "pipeline"
          ? await runPipelineRoute(app, definition.id, ac.signal)
          : plan.route === "worker"
            ? await runWorkerRoute({
                analysisId: definition.id,
                params,
                trajectory: app.system.trajectory,
                frameRange,
                selection,
                signal: ac.signal,
                shouldCancel: () => cancelRef.current || ac.signal.aborted,
              })
            : await runMainRoute({
                definition,
                params,
                trajectory: app.system.trajectory,
                frameRange,
                selection,
                signal: ac.signal,
              });
      // Whichever route ran, its verdict lands in the same `RunState`: a result
      // resets the frame slider and refreshes the stale-result fingerprint, an
      // `idle` verdict (aborted, cancelled) leaves both exactly as they were.
      if (next.status === "done") {
        setShownFrame(0);
        setResultFingerprint(currentFingerprint);
      }
      setRun(next);
    } catch (error) {
      if (ac.signal.aborted) {
        setRun({ status: "idle" });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/abort/i.test(message)) {
        setRun({ status: "idle" });
        return;
      }
      setRun({
        status: "error",
        message,
      });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  };

  const frames = run.frameIndices ?? [];
  const perFrameEntries = run.perFrame
    ? (run.payload as Array<{ frameIndex: number; value: unknown }> | undefined)
    : undefined;
  const shown = run.perFrame
    ? perFrameEntries?.[shownFrame]?.value
    : run.payload;

  const emptyTitle = isSeriesLike ? "No series yet" : "No result yet";

  return (
    <AnalysisPanelShell
      footer={
        <AnalysisRunBar
          scope={children}
          onRun={() => void execute()}
          onCancel={
            run.status === "running" && isSeriesLike ? handleCancel : undefined
          }
          running={run.status === "running"}
          disabled={!app || blockedReason !== undefined}
          label={`Run ${definition.label}`}
          summary={scopeSummary}
        />
      }
    >
      <div className="flex flex-col gap-2 p-2">
        <DocsLink href={molpyDocsForAnalysis(definition.id)}>
          {definition.label} · molpy handbook
        </DocsLink>

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
        <EmptyState density="compact" title={emptyTitle} />
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
