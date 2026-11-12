import { Slider } from "@molcrafts/ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export interface TrajectoryScrubProps {
  value: number;
  max: number;
  disabled?: boolean;
  /** Continuous drag (optimistic UI). */
  onValueChange: (frame: number) => void;
  /** Pointer/keyboard commit — last frame of a gesture. */
  onValueCommit?: (frame: number) => void;
  className?: string;
  "aria-label"?: string;
}

/**
 * Filmstrip scrub — thin track, filled range, playhead thumb.
 * Colors follow the app theme (light and dark).
 */
export function TrajectoryScrub({
  value,
  max,
  disabled = false,
  onValueChange,
  onValueCommit,
  className,
  "aria-label": ariaLabel = "Trajectory frame",
}: TrajectoryScrubProps): React.JSX.Element {
  const safeMax = Math.max(0, max);

  return (
    <Slider
      aria-label={ariaLabel}
      value={[value]}
      min={0}
      max={safeMax}
      step={1}
      disabled={disabled || safeMax <= 0}
      onValueChange={(vals) => {
        const next = vals[0];
        if (next !== undefined) onValueChange(next);
      }}
      onValueCommit={(vals) => {
        const next = vals[0];
        if (next !== undefined) onValueCommit?.(next);
      }}
      className={cn("h-control-compact", className)}
    />
  );
}
