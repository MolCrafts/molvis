import type { FrameRange } from "@molcrafts/molvis-stage";
import type React from "react";
import { Input } from "@/components/ui/input";
import { AnalysisAlert } from "./AnalysisAlert";

/**
 * Frame / atom scope for analyses. Shared, not per-analysis form chrome.
 * Shown only for multi-frame trajectories (caller gates visibility).
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

/** Compact frame range (+ optional atom scope) — no section title chrome. */
export const AnalysisScope: React.FC<AnalysisScopeProps> = ({
  value,
  onChange,
  trajectoryLength,
  selectedAtomCount,
  trackingWarning,
  hideAtomScope = false,
}) => {
  const last = Math.max(0, trajectoryLength - 1);

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <Input
          className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
          value={value.start}
          placeholder="0"
          onChange={(e) => onChange({ ...value, start: e.target.value })}
          aria-label="Start frame"
          title="Start frame"
        />
        <Input
          className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
          value={value.end}
          placeholder={String(last)}
          onChange={(e) => onChange({ ...value, end: e.target.value })}
          aria-label="End frame"
          title="End frame"
        />
        <Input
          className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
          value={value.stride}
          placeholder="1"
          onChange={(e) => onChange({ ...value, stride: e.target.value })}
          aria-label="Frame step"
          title="Frame step"
        />
      </div>

      {!hideAtomScope && (
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
      )}

      {!hideAtomScope && value.atoms === "selection" && (
        <AnalysisAlert tone="info">
          {trackingWarning ?? "Selection is followed by atom id."}
        </AnalysisAlert>
      )}
    </div>
  );
};

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
