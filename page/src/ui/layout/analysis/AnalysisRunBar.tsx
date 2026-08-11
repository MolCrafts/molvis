import { Loader2, Play, X } from "lucide-react";
import type React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { cn } from "@/lib/utils";

export interface AnalysisProgress {
  completed: number;
  total: number;
}

interface AnalysisRunBarProps {
  onRun: () => void;
  /**
   * Ask the running job to stop. Given one, a Cancel control appears beside the
   * busy Run control while `running` — panels without a cancellable job leave
   * this out and the bar looks exactly as before.
   */
  onCancel?: () => void;
  /**
   * Shared frame-scope control, rendered at the top of the footer chrome.
   * Only panels whose compute actually reads the range pass one — the footer
   * padding/border lives here so no panel hand-rolls a wrapper around the bar.
   */
  scope?: React.ReactNode;
  disabled?: boolean;
  running?: boolean;
  progress?: AnalysisProgress | null;
  /** Primary label when idle, e.g. "Compute RDF" — shown in tooltip. */
  label?: string;
  /** One-line context above the button (frame count, groups…). */
  summary?: string;
  /**
   * Pre-run message (block reason, requirement). Always **above** the button
   * so the user reads it before clicking Run — never under the control.
   */
  hint?: React.ReactNode;
}

/**
 * Footer run control for the analysis side panel — and the only owner of the
 * footer chrome (border, padding, blur).
 * Stack: scope → summary → hint → Run → progress bar.
 */
export const AnalysisRunBar: React.FC<AnalysisRunBarProps> = ({
  onRun,
  onCancel,
  scope,
  disabled = false,
  running = false,
  progress = null,
  label = "Run",
  summary,
  hint,
}) => {
  const pct =
    running && progress && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : null;
  const tip = running
    ? pct !== null
      ? `Running… ${pct}%`
      : "Running…"
    : label;

  return (
    // The footer chrome is deliberately not overridable: one border, one
    // padding, one density for every compute panel.
    <div className="shrink-0 border-t border-border/70 bg-background/95 px-2 py-2 space-y-1.5 backdrop-blur">
      {scope}
      {summary ? (
        <p className="truncate px-1 text-micro text-muted-foreground">
          {summary}
        </p>
      ) : null}
      {hint ? (
        <div className="px-1 text-micro leading-snug text-muted-foreground">
          {hint}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <ViewerAction
              className={cn(
                "min-w-0 flex-1",
                running && "disabled:opacity-100 opacity-100",
              )}
              onClick={onRun}
              disabled={disabled || running}
              aria-busy={running}
              aria-label={tip}
            >
              {running ? (
                <Loader2
                  className="molvis-spin h-3.5 w-3.5 shrink-0"
                  aria-hidden
                />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </ViewerAction>
          </TooltipTrigger>
          <TooltipContent side="top">{tip}</TooltipContent>
        </Tooltip>
        {/* Cancel sits next to the spinner, not in place of it: the running
            state stays readable while the job winds down. */}
        {running && onCancel ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <ViewerAction
                purpose="dismiss"
                className="shrink-0"
                onClick={onCancel}
                aria-label="Cancel run"
              >
                <X className="h-3.5 w-3.5" />
              </ViewerAction>
            </TooltipTrigger>
            <TooltipContent side="top">Cancel</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {running ? (
        <div
          role="progressbar"
          aria-label="Compute progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? 0}
          aria-valuetext={pct !== null ? `${pct}%` : "in progress"}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          {pct !== null && pct > 0 ? (
            <div
              className="h-full bg-status-running transition-[width] duration-(--motion-base) ease-linear"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="molvis-progress-indeterminate h-full w-1/3 rounded-full bg-status-running" />
          )}
        </div>
      ) : null}
    </div>
  );
};
