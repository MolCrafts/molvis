import {
  assessFrameForOptimize,
  assessOptimizeSize,
  defaultOptimizer,
  runOptimize as executeOptimize,
  formatOptimizeError,
  type Molvis,
  OPTIMIZE_STALL_MS,
  type OptimizeOutcome,
  type OptimizerKind,
  optimizersForPotential,
  type PotentialKind,
  probeBrowserMemory,
  UnsavedSceneError,
  warmComputeWorker,
} from "@molcrafts/molvis-stage";
import { FlaskConical } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberField } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  sceneHasUnsavedEdits,
  UnsavedSceneDialog,
} from "@/components/unsaved-scene-dialog";
import { DocsLink } from "@/components/viewer/DocsLink";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { useSelectedAtoms } from "@/hooks/useSelectedAtoms";
import { MOLPY_OPTIMIZE_DOCS } from "@/lib/molpy-docs";
import {
  OPTIMIZE_DIRTY_GATE_HINT,
  optimizeStagedLine,
} from "@/lib/optimize-staging-copy";
import { logStatusToConsole, reportStatus } from "@/lib/status-report";
import { AnalysisAlert } from "./analysis/AnalysisAlert";
import { AnalysisPanelShell } from "./analysis/AnalysisPanelShell";
import { AnalysisRunBar } from "./analysis/AnalysisRunBar";
import { ParamStack } from "./analysis/ParamStack";
import { ResultSection } from "./analysis/ResultSection";

interface StructureOptimizePanelProps {
  app: Molvis | null;
}

const POTENTIALS: Array<{ id: PotentialKind; label: string }> = [
  { id: "uff", label: "UFF" },
  { id: "mmff94", label: "MMFF94" },
  { id: "mmff94s", label: "MMFF94s" },
  { id: "soft", label: "Soft springs" },
];

const OPTIMIZERS: Array<{ id: OptimizerKind; label: string }> = [
  { id: "lbfgs", label: "L-BFGS" },
  { id: "damped", label: "Damped SD" },
];

const MENU_TRIGGER =
  "w-full min-w-0 border-0 bg-transparent px-2 shadow-none hover:bg-interactive focus-visible:border-0 focus-visible:ring-0";

type GuardKind = "size-warn" | "stall";

export const StructureOptimizePanel: React.FC<StructureOptimizePanelProps> = ({
  app,
}) => {
  const selectedAtoms = useSelectedAtoms(app);
  const [potential, setPotential] = useState<PotentialKind>("uff");
  const [optimizer, setOptimizer] = useState<OptimizerKind>(() =>
    defaultOptimizer("uff"),
  );
  const [fixedIndices, setFixedIndices] = useState<number[]>([]);
  const [maxSteps, setMaxSteps] = useState(200);
  const [forceTol, setForceTol] = useState(0.05);
  // Default off: H-cap on proteins (e.g. 20k → 90k) exceeds WASM L-BFGS limits.
  const [addHydrogens, setAddHydrogens] = useState(false);
  const [running, setRunning] = useState(false);
  /** Live status line for the Run footer (not a fake percentage). */
  const [runLine, setRunLine] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<OptimizeOutcome | null>(null);
  /** Last run failure — shown in-panel (status bar truncates long MMFF lines). */
  const [runError, setRunError] = useState<string | null>(null);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [guard, setGuard] = useState<{
    kind: GuardKind;
    message: string;
  } | null>(null);
  const [_sceneDirty, setSceneDirty] = useState(() =>
    sceneHasUnsavedEdits(app),
  );
  /**
   * Bumps on load / trajectory / optimize so atomCount + typeRisk re-read HEAD.
   * Dirty alone is not enough: a successful file open leaves the scene clean.
   */
  const [frameEpoch, setFrameEpoch] = useState(0);
  const cancelRef = useRef(false);
  /** Last status/progress beat — stall watchdog resets on every beat. */
  const lastBeatRef = useRef(0);
  /** Suppress re-opening stall dialog until the next beat after Continue. */
  const stallArmedRef = useRef(true);

  const allowedOptimizers = useMemo(
    () => optimizersForPotential(potential),
    [potential],
  );

  const handlePotentialChange = useCallback((next: PotentialKind) => {
    setPotential(next);
    setOptimizer(defaultOptimizer(next));
    setRunError(null);
  }, []);

  const handleOptimizerChange = useCallback(
    (next: OptimizerKind) => {
      if (!optimizersForPotential(potential).includes(next)) return;
      setOptimizer(next);
      setRunError(null);
    },
    [potential],
  );

  const hasApp = app !== null;
  const selectionCount = selectedAtoms.length;
  const fixedCount = fixedIndices.length;

  // frameEpoch / dirty / result force a re-read of HEAD after load/save/optimize.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional invalidation keys
  const atomCount = useMemo(() => {
    if (!app) return 0;
    try {
      return app.system.frame?.getBlock("atoms")?.nrows() ?? 0;
    } catch {
      return 0;
    }
  }, [app, frameEpoch, _sceneDirty, result]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional invalidation keys
  const bondCount = useMemo(() => {
    if (!app) return undefined;
    try {
      return app.system.frame?.getBlock("bonds")?.nrows() ?? undefined;
    } catch {
      return undefined;
    }
  }, [app, frameEpoch, _sceneDirty, result]);

  // Memory budget from this browser session (deviceMemory / JS heap), not a
  // fixed atom ceiling — a 32 GiB machine can take larger jobs than 4 GiB.
  const sizeRisk = useMemo(
    () =>
      assessOptimizeSize(atomCount, potential, {
        ...probeBrowserMemory(),
        bondCount,
      }),
    [atomCount, bondCount, potential],
  );

  /**
   * Element / force-field type preflight for the compute panel.
   * Status bar truncates — all typing issues render here as AnalysisAlert.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check after frame/dirty/result
  const typeRisk = useMemo(() => {
    if (!app) {
      return assessFrameForOptimize(null, potential);
    }
    try {
      return assessFrameForOptimize(app.system.frame, potential);
    } catch {
      return assessFrameForOptimize(null, potential);
    }
  }, [app, potential, frameEpoch, _sceneDirty, result, atomCount]);

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

  // File open / trajectory seek / pipeline publish — not dirty-change.
  useEffect(() => {
    if (!app) return;
    const bump = () => setFrameEpoch((n) => n + 1);
    bump();
    const offChange = app.events.on("frame-change", bump);
    const offLoad = app.events.on("frame-load-end", bump);
    return () => {
      offChange();
      offLoad();
    };
  }, [app]);

  // Lazy-start the shared compute worker when this panel is shown — not at
  // app boot, and not as a fat per-feature bundle. Domain code + molrs WASM
  // still load on the first actual optimize job inside the worker.
  useEffect(() => {
    if (!app) return;
    void warmComputeWorker().catch(() => {
      /* first Run will surface the error */
    });
  }, [app]);

  const emitStatus = useCallback(
    (
      text: string,
      type: "info" | "error" | "success" | "warning" = "info",
      progressPct?: number,
    ) => {
      lastBeatRef.current = Date.now();
      if (app?.events?.emit) {
        app.events.emit("status-message", {
          text,
          type,
          progress: progressPct,
        });
      } else {
        reportStatus(text, type, progressPct);
      }
    },
    [app],
  );

  // Stall watchdog: no progress beat for OPTIMIZE_STALL_MS while running.
  useEffect(() => {
    if (!running) {
      stallArmedRef.current = true;
      return;
    }
    const id = window.setInterval(() => {
      if (!stallArmedRef.current) return;
      if (cancelRef.current) return;
      if (Date.now() - lastBeatRef.current < OPTIMIZE_STALL_MS) return;
      stallArmedRef.current = false;
      setGuard({
        kind: "stall",
        message: `No status update for ${Math.round(OPTIMIZE_STALL_MS / 1000)}s on ${atomCount.toLocaleString()} atoms. You can keep waiting, or cancel.`,
      });
    }, 1_500);
    return () => window.clearInterval(id);
  }, [running, atomCount]);

  const handleUseSelectionAsFixed = useCallback(() => {
    if (selectionCount === 0) return;
    setFixedIndices([...selectedAtoms]);
  }, [selectedAtoms, selectionCount]);

  const handleClearFixed = useCallback(() => {
    setFixedIndices([]);
  }, []);

  const runOptimize = useCallback(async () => {
    if (!app || running) return;
    cancelRef.current = false;
    stallArmedRef.current = true;
    lastBeatRef.current = Date.now();
    setRunning(true);
    setResult(null);
    setRunError(null);
    setRunLine("Starting optimization…");
    // Bar always on while running; fill updates when we have real step/%.
    setProgress({ completed: 0, total: 100 });
    setGuard(null);
    // Panel owns the live line (summary). Status bar only gets terminal lines
    // so we do not double-print "Starting optimization…" in two places.
    emitStatus("Optimization running…", "info");

    try {
      const outcome = await executeOptimize(app, {
        potential,
        optimizer,
        maxSteps,
        forceTol,
        fixedIndices,
        addHydrogens,
        shouldCancel: () => cancelRef.current,
        onProgress: ({ step, maxSteps: total }) => {
          lastBeatRef.current = Date.now();
          stallArmedRef.current = true;
          if (total > 0 && step >= 0) {
            const pct = Math.min(
              98,
              Math.round((step / Math.max(1, total)) * 100),
            );
            setProgress({ completed: Math.max(pct, 1), total: 100 });
            setRunLine(`Step ${step}/${total}`);
          }
        },
        onStatus: ({ message, progress: pct, step, maxSteps: ms }) => {
          lastBeatRef.current = Date.now();
          stallArmedRef.current = true;
          setRunLine(message);
          if (pct !== undefined && Number.isFinite(pct) && pct > 0) {
            setProgress({
              completed: Math.round(Math.max(0, Math.min(100, pct))),
              total: 100,
            });
          } else if (step !== undefined && ms !== undefined && ms > 0) {
            const mapped = Math.min(98, Math.round((step / ms) * 100));
            setProgress({ completed: Math.max(mapped, 1), total: 100 });
          }
        },
      });

      setResult(outcome);

      // The run leaves its coordinates staged in the workspace, so every
      // outcome — converged, capped or cancelled — ends on the save hint.
      emitStatus(
        optimizeStagedLine(outcome),
        !outcome.cancelled && outcome.converged ? "success" : "info",
      );
    } catch (err) {
      if (err instanceof UnsavedSceneError) {
        setSavePromptOpen(true);
        // "Unsaved" also covers a staged optimize result now, so the gate has
        // to name whose edits it is asking the user to deal with.
        emitStatus(OPTIMIZE_DIRTY_GATE_HINT, "info");
      } else {
        const message = formatOptimizeError(err);
        setRunError(message);
        // Always hit native console with the Error object (stack). Status bar
        // truncates; DevTools is the full record.
        logStatusToConsole(message, "error", undefined, err);
        emitStatus(message, "error");
      }
    } finally {
      setRunning(false);
      setProgress(null);
      setRunLine(null);
      setGuard(null);
    }
  }, [
    addHydrogens,
    app,
    emitStatus,
    fixedIndices,
    forceTol,
    maxSteps,
    optimizer,
    potential,
    running,
  ]);

  /** Run click: type gate → size gate → unsaved gate → go. Errors stay in-panel. */
  const handleRun = useCallback(() => {
    if (!app || running) return;

    // Re-check against live frame (typeRisk memo may lag a tick after load).
    let liveType = typeRisk;
    try {
      liveType = assessFrameForOptimize(app.system.frame, potential);
    } catch {
      /* keep memoized */
    }
    if (liveType.level === "block") {
      setRunError(liveType.message);
      return;
    }

    if (sizeRisk.level === "hard_block" || sizeRisk.level === "soft_block") {
      setRunError(sizeRisk.message);
      return;
    }

    if (sizeRisk.level === "warn") {
      setRunError(null);
      setGuard({ kind: "size-warn", message: sizeRisk.message });
      return;
    }

    if (sceneHasUnsavedEdits(app)) {
      setSavePromptOpen(true);
      return;
    }
    setRunError(null);
    void runOptimize();
  }, [app, potential, runOptimize, running, sizeRisk, typeRisk]);

  const handleGuardContinue = useCallback(() => {
    if (!guard) return;
    if (guard.kind === "stall") {
      // Keep waiting — re-arm watchdog from now.
      lastBeatRef.current = Date.now();
      stallArmedRef.current = true;
      setGuard(null);
      emitStatus("Still optimizing… (keep waiting)", "warning");
      return;
    }
    // size-warn: proceed after user confirms.
    setGuard(null);
    if (!app) return;
    if (sceneHasUnsavedEdits(app)) {
      setSavePromptOpen(true);
      return;
    }
    void runOptimize();
  }, [app, emitStatus, guard, runOptimize]);

  const handleGuardCancel = useCallback(() => {
    if (guard?.kind === "stall") {
      cancelRef.current = true;
      setGuard(null);
      emitStatus("Cancelling optimization…", "warning");
      return;
    }
    setGuard(null);
    emitStatus("Optimization cancelled", "info");
  }, [emitStatus, guard]);

  const handleSaveAndRun = useCallback(() => {
    if (!app) return;
    setSavePromptOpen(false);
    app.commitScene();
    emitStatus("Scene saved", "success");
    void runOptimize();
  }, [app, emitStatus, runOptimize]);

  const handlePromptCancel = useCallback(() => {
    setSavePromptOpen(false);
    emitStatus("Optimization cancelled", "info");
  }, [emitStatus]);

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    emitStatus("Cancelling optimization…", "warning");
  }, [emitStatus]);

  if (!hasApp) {
    return (
      <EmptyState
        density="compact"
        className="min-h-0 flex-1 justify-center"
        icon={<FlaskConical className="h-8 w-8" />}
        title="Viewer not ready"
      />
    );
  }

  const potentialLabel =
    POTENTIALS.find((m) => m.id === potential)?.label ?? potential;
  // Running: live step line (not a mysterious bare "5%"). Idle: atom count.
  const summary = running
    ? (runLine ?? "Running…")
    : atomCount > 0
      ? `${atomCount.toLocaleString()} atoms${fixedCount > 0 ? ` · ${fixedCount} fixed` : ""}`
      : fixedCount > 0
        ? `${fixedCount} fixed`
        : undefined;

  const runBlocked =
    sizeRisk.level === "hard_block" ||
    sizeRisk.level === "soft_block" ||
    typeRisk.level === "block";

  /** Alerts sit in the footer, above Run — pre-run reading surface. */
  const showTypeBlock = !running && typeRisk.level === "block";
  const showTypeWarn = !running && typeRisk.level === "warn";
  const showRunError = !running && runError !== null && !showTypeBlock;
  const showSizeRisk = !running && sizeRisk.level !== "ok" && !showTypeBlock;
  const preRunAlerts =
    showTypeBlock || showTypeWarn || showRunError || showSizeRisk ? (
      <div className="space-y-1">
        {showTypeBlock && (
          <AnalysisAlert tone="error" className="mt-0">
            <span className="flex flex-col gap-1">
              <span className="font-medium">Cannot run {potentialLabel}</span>
              {typeRisk.issues.map((issue: string) => (
                <span key={issue}>{issue}</span>
              ))}
            </span>
          </AnalysisAlert>
        )}
        {showTypeWarn && (
          <AnalysisAlert tone="warning" className="mt-0">
            <span className="flex flex-col gap-1">
              {typeRisk.issues.map((issue: string) => (
                <span key={issue}>{issue}</span>
              ))}
            </span>
          </AnalysisAlert>
        )}
        {showRunError && (
          <AnalysisAlert tone="error" className="mt-0">
            {runError}
          </AnalysisAlert>
        )}
        {showSizeRisk && (
          <AnalysisAlert
            tone={sizeRisk.level === "warn" ? "warning" : "error"}
            className="mt-0"
          >
            {sizeRisk.message}
          </AnalysisAlert>
        )}
      </div>
    ) : null;

  return (
    <>
      <AnalysisPanelShell
        footer={
          <AnalysisRunBar
            onRun={handleRun}
            onCancel={handleCancel}
            running={running}
            progress={progress}
            disabled={runBlocked}
            label="Run optimization"
            summary={summary}
            hint={preRunAlerts}
          />
        }
      >
        <div className="space-y-3 p-2">
          <DocsLink href={MOLPY_OPTIMIZE_DOCS}>
            Geometry optimization · molpy handbook
          </DocsLink>

          <div className="grid grid-cols-2 gap-2">
            <ParamStack label="Potential">
              <Select
                value={potential}
                onValueChange={(v) => handlePotentialChange(v as PotentialKind)}
                disabled={running}
              >
                <SelectTrigger
                  size="sm"
                  className={MENU_TRIGGER}
                  aria-label="Potential"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-0 shadow-overlay">
                  {POTENTIALS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ParamStack>

            <ParamStack label="Optimizer">
              <Select
                value={optimizer}
                onValueChange={(v) => handleOptimizerChange(v as OptimizerKind)}
                disabled={running}
              >
                <SelectTrigger
                  size="sm"
                  className={MENU_TRIGGER}
                  aria-label="Optimizer"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-0 shadow-overlay">
                  {OPTIMIZERS.map((m) => {
                    const allowed = allowedOptimizers.includes(m.id);
                    return (
                      <SelectItem
                        key={m.id}
                        value={m.id}
                        disabled={!allowed}
                        title={
                          allowed
                            ? undefined
                            : `${m.label} unavailable for this potential`
                        }
                      >
                        {m.label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </ParamStack>
          </div>

          {/* Fixed atoms come from the canvas selection — a derived meta line
              plus its actions, not a field the user types into. */}
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate font-mono text-micro tabular-nums text-muted-foreground">
              {fixedCount === 0 ? "No fixed atoms" : `${fixedCount} fixed`}
            </span>
            <ViewerAction
              purpose="dismiss"
              disabled={running || selectionCount === 0}
              onClick={handleUseSelectionAsFixed}
              className="border-0 bg-transparent shadow-none hover:bg-interactive"
              title={
                selectionCount === 0
                  ? "Select atoms on the canvas first"
                  : `Fix ${selectionCount} selected atom${selectionCount === 1 ? "" : "s"}`
              }
            >
              Use selection
            </ViewerAction>
            {fixedCount > 0 && (
              <ViewerAction
                purpose="dismiss"
                disabled={running}
                onClick={handleClearFixed}
                className="border-0 bg-transparent shadow-none hover:bg-interactive"
              >
                Clear
              </ViewerAction>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <ParamStack label="Max steps">
              <NumberField
                aria-label="Max steps"
                value={maxSteps}
                min={10}
                max={5000}
                step={10}
                onChange={setMaxSteps}
                disabled={running}
                className="w-full"
              />
            </ParamStack>
            <ParamStack label="Force tol">
              <NumberField
                aria-label="Force tolerance"
                value={forceTol}
                min={0.0001}
                max={1}
                step={0.001}
                onChange={setForceTol}
                disabled={running}
                className="w-full"
              />
            </ParamStack>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-micro text-muted-foreground">
              Add hydrogens
            </span>
            <Switch
              aria-label="Add hydrogens"
              checked={addHydrogens}
              onCheckedChange={setAddHydrogens}
              disabled={running}
            />
          </div>

          {!result && !running && (
            <EmptyState density="compact" title="No optimization yet" />
          )}

          {result && (
            <ResultSection defaultOpen>
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-micro tabular-nums">
                <span className="text-muted-foreground">Potential</span>
                <span className="text-right">
                  {POTENTIALS.find((m) => m.id === result.potential)?.label}
                </span>
                <span className="text-muted-foreground">Optimizer</span>
                <span className="text-right">
                  {OPTIMIZERS.find((m) => m.id === result.optimizer)?.label ??
                    result.optimizer}
                </span>
                <span className="text-muted-foreground">Atoms</span>
                <span className="text-right font-mono">{result.atomCount}</span>
                <span className="text-muted-foreground">Steps</span>
                <span className="text-right font-mono">{result.steps}</span>
                <span className="text-muted-foreground">Energy</span>
                <span className="text-right font-mono">
                  {result.energy.toFixed(3)}
                </span>
                <span className="text-muted-foreground">Max |F|</span>
                <span className="text-right font-mono">
                  {result.maxForce.toFixed(4)}
                </span>
                <span className="text-muted-foreground">Status</span>
                {/* Success tone only when it converged; hitting the step cap is
                    a stop, not a success. */}
                <span
                  className={
                    result.converged
                      ? "text-right text-success-foreground"
                      : "text-right text-muted-foreground"
                  }
                >
                  {result.converged ? "Converged" : "Max steps"}
                </span>
              </div>
            </ResultSection>
          )}
        </div>
      </AnalysisPanelShell>

      <UnsavedSceneDialog
        open={savePromptOpen}
        title="Save before optimize?"
        description="Save canvas edits first, or cancel."
        saveLabel="Save and run"
        onSave={handleSaveAndRun}
        onCancel={handlePromptCancel}
      />

      <Dialog
        open={guard !== null}
        onOpenChange={(next) => {
          if (!next) handleGuardCancel();
        }}
      >
        <DialogContent className="max-w-dialog-sm gap-3 p-4" showCloseButton>
          <DialogHeader>
            <DialogTitle className="text-sm">
              {guard?.kind === "stall"
                ? "Optimization stalled"
                : "Large structure"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-micro leading-snug text-muted-foreground">
            {guard?.message}
          </p>
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <div className="grid w-full grid-cols-2 gap-1.5">
              <ViewerAction className="w-full" onClick={handleGuardContinue}>
                {guard?.kind === "stall" ? "Keep waiting" : "Continue"}
              </ViewerAction>
              <ViewerAction
                purpose="dismiss"
                className="w-full"
                onClick={handleGuardCancel}
              >
                {guard?.kind === "stall" ? "Cancel run" : "Cancel"}
              </ViewerAction>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
