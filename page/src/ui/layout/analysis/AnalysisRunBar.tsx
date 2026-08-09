import { Loader2, Play } from "lucide-react";
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
  disabled?: boolean;
  running?: boolean;
  progress?: AnalysisProgress | null;
  /** Primary label when idle, e.g. "Compute RDF" — shown in tooltip. */
  label?: string;
  /** One-line context shown above the button (frame count, groups…). */
  summary?: string;
  /** Why the button is disabled / blocked — shown under the bar. */
  hint?: React.ReactNode;
  className?: string;
}

/**
 * Footer run control for the analysis side panel. Renders as a true column
 * footer (via {@link AnalysisPanelShell}), not sticky mid-scroll content.
 * Icon-only primary action; the full label lives in the tooltip.
 */
export const AnalysisRunBar: React.FC<AnalysisRunBarProps> = ({
  onRun,
  disabled = false,
  running = false,
  progress = null,
  label = "Run",
  summary,
  hint,
  className,
}) => {
  const progressLabel =
    running && progress && progress.total > 0
      ? `${progress.completed}/${progress.total}`
      : null;
  const tip = running
    ? progressLabel
      ? `Running… ${progressLabel}`
      : "Running…"
    : label;

  return (
    <div
      className={cn(
        "shrink-0 border-t border-border/70 bg-background/95 px-2 py-2 space-y-1 backdrop-blur",
        className,
      )}
    >
      {summary && (
        <p className="truncate px-1 text-micro tabular-nums text-muted-foreground">
          {summary}
        </p>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <ViewerAction
            className="w-full"
            onClick={onRun}
            disabled={disabled || running}
            aria-busy={running}
            aria-label={tip}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </ViewerAction>
        </TooltipTrigger>
        <TooltipContent side="top">{tip}</TooltipContent>
      </Tooltip>
      {running && progress && progress.total > 0 && (
        <div
          role="progressbar"
          aria-label="Compute progress"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
          aria-valuetext={progressLabel ?? undefined}
          className="h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-status-running transition-[width] duration-(--motion-base) ease-linear"
            style={{
              width: `${Math.min(100, (progress.completed / progress.total) * 100)}%`,
            }}
          />
        </div>
      )}
      {hint && (
        <div className="px-1 text-micro leading-snug text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
};
