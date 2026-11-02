import { DisplayNumber } from "@molcrafts/molvis-core/display-number";
import {
  computeGlobalDensity,
  type GlobalDensityResult,
  type Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useState } from "react";
import { useSelectedAtoms } from "@/hooks/useSelectedAtoms";
import { AnalysisAlert } from "./AnalysisAlert";
import { AnalysisPanelShell } from "./AnalysisPanelShell";
import { AnalysisRunBar } from "./AnalysisRunBar";

/** Product compute id — not a molrs catalog key. */
export const GLOBAL_DENSITY_ANALYSIS_ID = "density.global_density";

interface GlobalDensityPanelProps {
  app: Molvis | null;
  children?: React.ReactNode;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-micro text-muted-foreground">{label}</span>
      <span className="font-mono text-xs tabular-nums">{value}</span>
    </div>
  );
}

function ScopeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-control-compact truncate rounded-control border px-2 text-xs transition-colors duration-(--motion-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-accent bg-accent/10 font-medium text-foreground"
          : "border-input bg-transparent text-muted-foreground hover:bg-muted/40"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Box density for all atoms or the current selection.
 */
export const GlobalDensityPanel: React.FC<GlobalDensityPanelProps> = ({
  app,
  children,
}) => {
  const [atomScope, setAtomScope] = useState<"all" | "selection">("all");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GlobalDensityResult | null>(null);
  const selectedAtoms = useSelectedAtoms(app);

  const handleRun = useCallback(() => {
    if (!app) return;
    const frame = app.system.frame;
    if (!frame) {
      setError("No frame loaded.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      setResult(
        computeGlobalDensity(frame, {
          species: "all",
          selected: atomScope === "selection" ? selectedAtoms : undefined,
        }),
      );
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Density failed");
    } finally {
      setRunning(false);
    }
  }, [app, atomScope, selectedAtoms]);

  const row = result?.rows[0];

  return (
    <AnalysisPanelShell
      controls={
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <ScopeButton
              active={atomScope === "all"}
              onClick={() => setAtomScope("all")}
            >
              All
            </ScopeButton>
            <ScopeButton
              active={atomScope === "selection"}
              disabled={selectedAtoms.length === 0}
              onClick={() => setAtomScope("selection")}
            >
              Selection
            </ScopeButton>
          </div>
          {error ? <AnalysisAlert tone="error">{error}</AnalysisAlert> : null}
          <AnalysisRunBar
            onRun={handleRun}
            running={running}
            disabled={running || !app}
            label="Run"
            scope={children}
          />
        </>
      }
      results={
        row && result ? (
          <div className="divide-y divide-border/50">
            <Fact
              label="V"
              value={`${new DisplayNumber(result.volume).science()} Å³`}
            />
            <Fact label="N" value={String(row.nAtoms)} />
            <Fact
              label="ρ"
              value={`${new DisplayNumber(row.numberDensity).science()} Å⁻³`}
            />
            {row.massDensity != null ? (
              <Fact
                label="ρ"
                value={`${new DisplayNumber(row.massDensity).science()} g·cm⁻³`}
              />
            ) : null}
          </div>
        ) : null
      }
    />
  );
};
