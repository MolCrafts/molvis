import type { FrameRange } from "@molvis/core";
import type React from "react";
import { Input } from "@/components/ui/input";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { AnalysisAlert } from "./AnalysisAlert";

/**
 * The analysis scope: which frames to visit, and which atoms to follow.
 *
 * This is deliberately a **shared region**, never folded into an analysis's
 * parameter form: the frame range and the tracked atom selection mean the same
 * thing for every analysis and must not be re-declared per analysis.
 *
 * Note: analyses with their own group pickers (RDF A/B, MSD atoms) still use
 * this for frames; their atom rows are analysis-specific parameters.
 */

export type AtomScope = "all" | "selection";

export interface ScopeState {
  start: string;
  end: string;
  stride: string;
  atoms: AtomScope;
}

export const DEFAULT_SCOPE: ScopeState = {
  start: "0",
  end: "",
  stride: "1",
  atoms: "all",
};

export function parseScopeRange(
  scope: ScopeState,
  trajectoryLength: number,
): FrameRange {
  const last = Math.max(0, trajectoryLength - 1);
  const start = Number.parseInt(scope.start, 10);
  const end = scope.end.trim() === "" ? last : Number.parseInt(scope.end, 10);
  const stride = Number.parseInt(scope.stride, 10);
  return {
    start: Number.isFinite(start) ? start : 0,
    endInclusive: Number.isFinite(end) ? end : last,
    stride: Number.isFinite(stride) && stride > 0 ? stride : 1,
  };
}

/** How many frames the current scope will actually visit. */
export function scopeFrameCount(
  range: FrameRange,
  trajectoryLength: number,
): number {
  if (trajectoryLength <= 0) return 0;
  const last = trajectoryLength - 1;
  const start = Math.max(0, Math.min(range.start ?? 0, last));
  const end = Math.max(0, Math.min(range.endInclusive ?? last, last));
  const stride = Math.max(1, range.stride ?? 1);
  return start > end ? 0 : Math.floor((end - start) / stride) + 1;
}

/** Short summary for the sticky run bar. */
export function formatScopeSummary(
  scope: ScopeState,
  trajectoryLength: number,
  selectedAtomCount: number,
): string {
  const range = parseScopeRange(scope, trajectoryLength);
  const visited = scopeFrameCount(range, trajectoryLength);
  const atoms =
    scope.atoms === "selection" ? `${selectedAtomCount} selected` : "all atoms";
  return `${visited} frame${visited === 1 ? "" : "s"} · ${atoms}`;
}

interface AnalysisScopeProps {
  value: ScopeState;
  onChange: (next: ScopeState) => void;
  trajectoryLength: number;
  selectedAtomCount: number;
  /** Set when the selection cannot be followed by a stable atom id. */
  trackingWarning?: string;
  /**
   * When true, hide the All/Selection atom toggles — the active analysis owns
   * its own atom groups (RDF A/B, MSD, …).
   */
  hideAtomScope?: boolean;
}

export const AnalysisScope: React.FC<AnalysisScopeProps> = ({
  value,
  onChange,
  trajectoryLength,
  selectedAtomCount,
  trackingWarning,
  hideAtomScope = false,
}) => {
  const last = Math.max(0, trajectoryLength - 1);
  const visited = scopeFrameCount(
    parseScopeRange(value, trajectoryLength),
    trajectoryLength,
  );

  return (
    <SidebarSection
      title="Scope"
      subtitle={`${visited} of ${trajectoryLength} frame${trajectoryLength === 1 ? "" : "s"}`}
      defaultOpen={true}
    >
      <div className="grid grid-cols-3 gap-1.5">
        <ScopeField
          label="Start"
          value={value.start}
          placeholder="0"
          onChange={(start) => onChange({ ...value, start })}
        />
        <ScopeField
          label="End"
          value={value.end}
          placeholder={String(last)}
          onChange={(end) => onChange({ ...value, end })}
        />
        <ScopeField
          label="Step"
          value={value.stride}
          placeholder="1"
          onChange={(stride) => onChange({ ...value, stride })}
        />
      </div>

      {!hideAtomScope && (
        <fieldset className="mt-2">
          <legend className="text-[10px] text-muted-foreground mb-1">
            Atoms
          </legend>
          <div className="grid grid-cols-2 gap-1.5">
            <ScopeToggle
              active={value.atoms === "all"}
              onClick={() => onChange({ ...value, atoms: "all" })}
            >
              All atoms
            </ScopeToggle>
            <ScopeToggle
              active={value.atoms === "selection"}
              disabled={selectedAtomCount === 0}
              onClick={() => onChange({ ...value, atoms: "selection" })}
            >
              Selection ({selectedAtomCount})
            </ScopeToggle>
          </div>
        </fieldset>
      )}

      {!hideAtomScope && value.atoms === "selection" && (
        <AnalysisAlert tone="info">
          {trackingWarning ??
            "Atoms picked in the first visited frame are followed across the range by their atom id."}
        </AnalysisAlert>
      )}
    </SidebarSection>
  );
};

function ScopeField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-[10px] text-muted-foreground">
        {label}
      </span>
      <Input
        className="h-7 min-w-0 font-mono text-xs tabular-nums"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} frame`}
      />
    </div>
  );
}

function ScopeToggle({
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
      className={`h-7 truncate rounded-md border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-primary bg-primary/10 text-foreground font-medium"
          : "border-input bg-transparent text-muted-foreground hover:bg-muted/40"
      }`}
    >
      {children}
    </button>
  );
}
