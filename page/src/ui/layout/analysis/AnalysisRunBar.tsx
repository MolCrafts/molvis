import { Loader2, Play } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
        "shrink-0 border-t border-border/70 bg-background/95 px-2 py-1.5 space-y-1 backdrop-blur",
        className,
      )}
    >
      {summary && (
        <p className="truncate px-0.5 text-[10px] tabular-nums text-muted-foreground">
          {summary}
        </p>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            className="h-7 w-full gap-1.5 border-0 px-0 text-xs"
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
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{tip}</TooltipContent>
      </Tooltip>
      {running && progress && progress.total > 0 && (
        <div
          className="h-0.5 overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          <div
            className="h-full bg-primary transition-[width] duration-150"
            style={{
              width: `${Math.min(100, (progress.completed / progress.total) * 100)}%`,
            }}
          />
        </div>
      )}
      {hint && (
        <div className="px-0.5 text-[10px] leading-snug text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
};
