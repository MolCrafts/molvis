import {
  assessFrameForOptimize,
  assessOptimizeSize,
  runOptimize as executeOptimize,
  type Molvis,
  OPTIMIZE_STALL_MS,
  type PotentialKind,
  probeBrowserMemory,
  UnsavedSceneError,
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
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { useSelectedAtoms } from "@/hooks/useSelectedAtoms";
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
  { id: "soft", label: "Soft" },
];

const MENU_TRIGGER =
  "w-full min-w-0 border-0 bg-transparent px-2 shadow-none hover:bg-interactive focus-visible:border-0 focus-visible:ring-0";

interface OptimizeResult {
  potential: PotentialKind;
  steps: number;
  energy: number;
  maxForce: number;
  converged: boolean;
  fixedCount: number;
  atomCount: number;
}

type GuardKind = "size-warn" | "stall";

export const StructureOptimizePanel: React.FC<StructureOptimizePanelProps> = ({
  app,
}) => {
  const selectedAtoms = useSelectedAtoms(app);
  const [potential, setPotential] = useState<PotentialKind>("uff");
  const [fixedIndices, setFixedIndices] = useState<number[]>([]);
  const [maxSteps, setMaxSteps] = useState(200);
  const [forceTol, setForceTol] = useState(0.05);
  // Default off: H-cap on proteins (e.g. 20k → 90k) exceeds WASM L-BFGS limits.
  const [addHydrogens, setAddHydrogens] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<OptimizeResult | null>(null);
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
  const cancelRef = useRef(false);
  /** Last status/progress beat — stall watchdog resets on every beat. */
  const lastBeatRef = useRef(0);
  /** Suppress re-opening stall dialog until the next beat after Continue. */
  const stallArmedRef = useRef(true);

  const hasApp = app !== null;
  const selectionCount = selectedAtoms.length;
  const fixedCount = fixedIndices.length;

  // _sceneDirty / result force a re-read of HEAD after save/load/optimize.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional invalidation keys
  const atomCount = useMemo(() => {
    if (!app) return 0;
    try {
      return app.system.frame?.getBlock("atoms")?.nrows() ?? 0;
    } catch {
      return 0;
    }
  }, [app, _sceneDirty, result]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional invalidation keys
  const bondCount = useMemo(() => {
    if (!app) return undefined;
    try {
      return app.system.frame?.getBlock("bonds")?.nrows() ?? undefined;
    } catch {
      return undefined;
    }
  }, [app, _sceneDirty, result]);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check after dirty/result/N
  const typeRisk = useMemo(() => {
    if (!app) {
      return assessFrameForOptimize(null, potential);
    }
    try {
      return assessFrameForOptimize(app.system.frame, potential);
    } catch {
      return assessFrameForOptimize(null, potential);
    }
  }, [app, potential, _sceneDirty, result, atomCount]);

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
        message: `No progress for ${Math.round(OPTIMIZE_STALL_MS / 1000)}s. The tab may look frozen while WASM works on ${atomCount.toLocaleString()} atoms. Keep waiting, or cancel the run.`,
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
    setProgress({ completed: 0, total: maxSteps });
    setGuard(null);
    emitStatus("Optimizing structure…", "info", 0);

    try {
      const outcome = await executeOptimize(app, {
        potential,
        maxSteps,
        forceTol,
        fixedIndices,
        addHydrogens,
        shouldCancel: () => cancelRef.current,
        onProgress: ({ step, maxSteps: total }) => {
          lastBeatRef.current = Date.now();
          stallArmedRef.current = true;
          setProgress({ completed: step, total });
        },
        onStatus: ({ message, progress: pct }) => {
          lastBeatRef.current = Date.now();
          stallArmedRef.current = true;
          emitStatus(message, "info", pct);
        },
      });

      setResult({
        potential: outcome.potential,
        steps: outcome.steps,
        energy: outcome.energy,
        maxForce: outcome.maxForce,
        converged: outcome.converged,
        fixedCount: outcome.fixedCount,
        atomCount: outcome.atomCount,
      });

      const hNote =
        outcome.hydrogensAdded > 0 ? ` · +${outcome.hydrogensAdded} H` : "";
      if (outcome.cancelled) {
        emitStatus("Optimization cancelled", "info");
      } else if (outcome.converged) {
        emitStatus(
          `Optimized in ${outcome.steps} steps · max |F| ${outcome.maxForce.toFixed(3)}${hNote}`,
          "success",
        );
      } else {
        emitStatus(
          `Optimization stopped at max steps (${outcome.steps})${hNote}`,
          "info",
        );
      }
    } catch (err) {
      if (err instanceof UnsavedSceneError) {
        setSavePromptOpen(true);
        emitStatus("Save scene before optimizing", "info");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setRunError(message);
        // Explicit native console sink with the Error object (stack) — status
        // bar truncates; DevTools must show the full force-field setup failure.
        logStatusToConsole(message, "error", undefined, err);
        emitStatus(message, "error");
      }
    } finally {
      setRunning(false);
      setProgress(null);
      setGuard(null);
    }
  }, [
    addHydrogens,
    app,
    emitStatus,
    fixedIndices,
    forceTol,
    maxSteps,
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
        description="Wait for the canvas to initialize."
      />
    );
  }

  const potentialLabel =
    POTENTIALS.find((m) => m.id === potential)?.label ?? potential;
  const summary = running
    ? progress
      ? `Step ${progress.completed}/${progress.total}`
      : "Relaxing…"
    : `${potentialLabel}${atomCount > 0 ? ` · ${atomCount.toLocaleString()} atoms` : ""}${fixedCount > 0 ? ` · ${fixedCount} fixed` : ""}`;

  const runBlocked =
    sizeRisk.level === "hard_block" ||
    sizeRisk.level === "soft_block" ||
    typeRisk.level === "block";

  const typeHint =
    typeRisk.level === "block"
      ? (typeRisk.issues[0] ?? typeRisk.message)
      : typeRisk.level === "warn"
        ? typeRisk.issues[0]
        : sizeRisk.level === "hard_block" || sizeRisk.level === "soft_block"
          ? sizeRisk.message
          : undefined;

  return (
    <>
      <AnalysisPanelShell
        footer={
          <div className="space-y-1">
            {running && (
              <div className="px-2">
                <ViewerAction
                  purpose="dismiss"
                  className="w-full border-0"
                  onClick={handleCancel}
                >
                  Cancel
                </ViewerAction>
              </div>
            )}
            <AnalysisRunBar
              onRun={handleRun}
              running={running}
              progress={progress}
              disabled={runBlocked}
              label="Run optimization"
              summary={summary}
              hint={runBlocked ? typeHint : undefined}
            />
          </div>
        }
      >
        <div className="space-y-3 p-2">
          <ParamStack label="Potential">
            <Select
              value={potential}
              onValueChange={(v) => {
                setPotential(v as PotentialKind);
                setRunError(null);
              }}
              disabled={running}
            >
              <SelectTrigger
                size="sm"
                className={MENU_TRIGGER}
                aria-label="Force field"
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

          {/*
            Compute-panel surface for typing/size issues. Full text here —
            do not rely on the status bar (truncates long MMFF lines).
          */}
          {!running && typeRisk.level === "block" && (
            <AnalysisAlert tone="error" className="mt-0">
              <span className="flex flex-col gap-1">
                <span className="font-medium">Cannot run {potentialLabel}</span>
                {typeRisk.issues.map((issue: string) => (
                  <span key={issue}>{issue}</span>
                ))}
              </span>
            </AnalysisAlert>
          )}
          {!running && typeRisk.level === "warn" && (
            <AnalysisAlert tone="warning" className="mt-0">
              <span className="flex flex-col gap-1">
                {typeRisk.issues.map((issue: string) => (
                  <span key={issue}>{issue}</span>
                ))}
              </span>
            </AnalysisAlert>
          )}
          {!running && runError && typeRisk.level !== "block" && (
            <AnalysisAlert tone="error" className="mt-0">
              {runError}
            </AnalysisAlert>
          )}
          {!running &&
            sizeRisk.level !== "ok" &&
            typeRisk.level !== "block" && (
              <AnalysisAlert
                tone={sizeRisk.level === "warn" ? "warning" : "error"}
                className="mt-0"
              >
                {sizeRisk.message}
              </AnalysisAlert>
            )}

          <ParamStack label="Fixed">
            <div className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-body-lg tabular-nums">
                {fixedCount === 0 ? "None" : `${fixedCount}`}
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
          </ParamStack>

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

          {result && (
            <ResultSection defaultOpen>
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-micro tabular-nums">
                <span className="text-muted-foreground">Potential</span>
                <span className="text-right">
                  {POTENTIALS.find((m) => m.id === result.potential)?.label}
                </span>
                <span className="text-muted-foreground">Atoms</span>
                <span className="text-right">{result.atomCount}</span>
                <span className="text-muted-foreground">Steps</span>
                <span className="text-right">{result.steps}</span>
                <span className="text-muted-foreground">Energy</span>
                <span className="text-right">{result.energy.toFixed(3)}</span>
                <span className="text-muted-foreground">Max |F|</span>
                <span className="text-right">{result.maxForce.toFixed(4)}</span>
                <span className="text-muted-foreground">Status</span>
                <span className="text-right text-success-foreground">
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
        description="Optimization runs on the saved structure. Save canvas edits first, or cancel."
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
