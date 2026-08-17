import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Three steps below 1× and three above — click cycles through this ladder. */
export const TRAJECTORY_SPEED_STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8] as const;

interface TrajectoryPlaybackControlsProps {
  compact: boolean;
  isPlaying: boolean;
  disabled?: boolean;
  speed: number;
  onSpeedChange: (speed: number) => void;
  onFirstFrame: () => void;
  onPreviousFrame: () => void;
  onTogglePlayback: () => void;
  onNextFrame: () => void;
  onLastFrame: () => void;
}

function TransportButton({
  label,
  disabled,
  onClick,
  children,
  primary = false,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors",
        "focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-35",
        primary
          ? "bg-accent text-accent-foreground hover:bg-accent/90"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function formatSpeedLabel(speed: number): string {
  if (speed < 1) {
    // 0.125 → .125× / 0.25 → .25× — compact mono
    const s = speed.toString().replace(/^0/, "");
    return `${s}×`;
  }
  return `${speed}×`;
}

function nextSpeed(current: number): number {
  const steps = TRAJECTORY_SPEED_STEPS as readonly number[];
  const idx = steps.indexOf(current);
  if (idx < 0) return 1;
  return steps[(idx + 1) % steps.length] ?? 1;
}

/**
 * Quiet transport for the trajectory HUD. Theme tokens only.
 * Speed is a click-to-cycle control (no menu).
 */
export function TrajectoryPlaybackControls({
  compact,
  isPlaying,
  disabled = false,
  speed,
  onSpeedChange,
  onFirstFrame,
  onPreviousFrame,
  onTogglePlayback,
  onNextFrame,
  onLastFrame,
}: TrajectoryPlaybackControlsProps) {
  const speedLabel = formatSpeedLabel(speed);
  const icon = "size-3.5 shrink-0";

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {!compact && (
        <button
          type="button"
          disabled={disabled}
          aria-label={`Playback speed ${speedLabel}. Click to change.`}
          title={`Speed ${speedLabel} — click to cycle`}
          onClick={() => onSpeedChange(nextSpeed(speed))}
          className={cn(
            "flex h-7 min-w-8 shrink-0 items-center justify-center rounded-md px-1.5",
            "font-mono text-[11px] tabular-nums text-muted-foreground",
            "transition-colors hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-35",
          )}
        >
          {speedLabel}
        </button>
      )}

      {!compact && (
        <TransportButton
          label="First frame"
          disabled={disabled}
          onClick={onFirstFrame}
        >
          <SkipBack className={icon} strokeWidth={2} />
        </TransportButton>
      )}
      <TransportButton
        label="Previous frame"
        disabled={disabled}
        onClick={onPreviousFrame}
      >
        <StepBack className={icon} strokeWidth={2} />
      </TransportButton>
      <TransportButton
        label={isPlaying ? "Pause trajectory" : "Play trajectory"}
        disabled={disabled && !isPlaying}
        onClick={onTogglePlayback}
        primary
      >
        {isPlaying ? (
          <Pause className={icon} strokeWidth={2.25} />
        ) : (
          <Play className={cn(icon, "translate-x-px")} strokeWidth={2.25} />
        )}
      </TransportButton>
      <TransportButton
        label="Next frame"
        disabled={disabled}
        onClick={onNextFrame}
      >
        <StepForward className={icon} strokeWidth={2} />
      </TransportButton>
      {!compact && (
        <TransportButton
          label="Last frame"
          disabled={disabled}
          onClick={onLastFrame}
        >
          <SkipForward className={icon} strokeWidth={2} />
        </TransportButton>
      )}
    </div>
  );
}
