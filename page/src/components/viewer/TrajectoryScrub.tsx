import * as SliderPrimitive from "@radix-ui/react-slider";
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
    <SliderPrimitive.Root
      data-slot="trajectory-scrub"
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
      className={cn(
        "relative flex h-8 w-full touch-none select-none items-center",
        "data-disabled:opacity-40",
        className,
      )}
    >
      <SliderPrimitive.Track
        data-slot="trajectory-scrub-track"
        className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range
          data-slot="trajectory-scrub-range"
          className="absolute h-full rounded-full bg-accent"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="trajectory-scrub-thumb"
        className={cn(
          "block h-4 w-2 shrink-0 rounded-full border-2 border-background bg-accent outline-none",
          "shadow-sm",
          "transition-transform duration-(--motion-fast) ease-standard",
          "hover:scale-110",
          "focus-visible:ring-2 focus-visible:ring-ring/60",
          "active:scale-105",
          "disabled:pointer-events-none",
        )}
      />
    </SliderPrimitive.Root>
  );
}
