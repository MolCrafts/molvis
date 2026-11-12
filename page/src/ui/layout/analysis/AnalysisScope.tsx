import type { FrameRange } from "@molcrafts/molvis-stage";
import { Callout, Input, ToggleAction } from "@molcrafts/ui";
import type React from "react";

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

export type ParseScopeResult =
  | { ok: true; range: FrameRange }
  | { ok: false; reason: "needs-explicit-end" };

export function parseScopeRange(
  scope: ScopeState,
  trajectoryLength: number,
  opts?: { indexComplete?: boolean },
): ParseScopeResult {
  const last = Math.max(0, trajectoryLength - 1);
  const start = Number.parseInt(scope.start, 10);
  const emptyEnd = scope.end.trim() === "";
  if (emptyEnd && opts?.indexComplete === false) {
    return { ok: false, reason: "needs-explicit-end" };
  }
  const end = emptyEnd ? last : Number.parseInt(scope.end, 10);
  const stride = Number.parseInt(scope.stride, 10);
  return {
    ok: true,
    range: {
      start: Number.isFinite(start) ? start : 0,
      endInclusive: Number.isFinite(end) ? end : last,
      stride: Number.isFinite(stride) && stride > 0 ? stride : 1,
    },
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
  const parsed = parseScopeRange(scope, trajectoryLength);
  const range = parsed.ok
    ? parsed.range
    : { start: 0, endInclusive: 0, stride: 1 };
  const visited = parsed.ok ? scopeFrameCount(range, trajectoryLength) : 0;
  const atoms =
    scope.atoms === "selection" ? `${selectedAtomCount} selected` : "all atoms";
  return `${visited} frame${visited === 1 ? "" : "s"} · ${atoms}`;
}

interface AnalysisScopeProps {
  value: ScopeState;
  onChange: (next: ScopeState) => void;
  trajectoryLength: number;
  indexComplete?: boolean;
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
  indexComplete = true,
  selectedAtomCount,
  trackingWarning,
  hideAtomScope = false,
}) => {
  const last = Math.max(0, trajectoryLength - 1);
  const parsed = parseScopeRange(value, trajectoryLength, { indexComplete });

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <Input
          className="h-control-compact min-w-0 font-mono text-label tabular-nums"
          value={value.start}
          placeholder="0"
          onChange={(e) => onChange({ ...value, start: e.target.value })}
          aria-label="Start frame"
          title="Start frame"
        />
        <Input
          className="h-control-compact min-w-0 font-mono text-label tabular-nums"
          value={value.end}
          placeholder={indexComplete ? String(last) : "end"}
          onChange={(e) => onChange({ ...value, end: e.target.value })}
          aria-label="End frame"
          title={
            indexComplete
              ? "End frame"
              : "Explicit end required while the index is still scanning"
          }
        />
        <Input
          className="h-control-compact min-w-0 font-mono text-label tabular-nums"
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

      {!parsed.ok && (
        <Callout tone="info">
          Set an explicit end frame — the index is still scanning.
        </Callout>
      )}

      {!hideAtomScope && value.atoms === "selection" && (
        <Callout tone="info">
          {trackingWarning ?? "Selection is followed by atom id."}
        </Callout>
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
    <ToggleAction
      selected={active}
      disabled={disabled}
      onClick={onClick}
      className="min-w-0 truncate"
    >
      {children}
    </ToggleAction>
  );
}
