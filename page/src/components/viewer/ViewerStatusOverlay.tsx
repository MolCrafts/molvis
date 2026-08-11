import type { Molvis } from "@molcrafts/molvis-stage";
import { AlertCircle, AlertTriangle, Check, Info, Loader2 } from "lucide-react";
import type React from "react";
import { useStatusMessage } from "@/hooks/useStatusMessage";
import type { StatusReportType } from "@/lib/status-report";
import { cn } from "@/lib/utils";

export interface ViewerStatusOverlayProps {
  app: Molvis | null;
  className?: string;
  /**
   * When true, the host already centers the overlay in a bottom HUD stack —
   * only the chip is rendered (no absolute positioning).
   */
  embedded?: boolean;
}

function ActivityIcon({
  type,
  progress,
}: {
  type: StatusReportType;
  progress?: number;
}) {
  const className = "size-3 shrink-0";
  if (type === "error") {
    return <AlertCircle className={cn(className, "text-status-failed")} />;
  }
  if (type === "warning") {
    return <AlertTriangle className={cn(className, "text-status-warning")} />;
  }
  if (type === "success") {
    return <Check className={cn(className, "text-status-completed")} />;
  }
  if (progress !== undefined) {
    return (
      <Loader2
        className={cn(className, "animate-spin text-muted-foreground")}
      />
    );
  }
  return <Info className={cn(className, "text-muted-foreground")} />;
}

function chipTone(type: StatusReportType): string {
  switch (type) {
    case "error":
      return "border-status-failed/30 bg-status-failed-soft text-status-failed-foreground";
    case "warning":
      return "border-status-warning/30 bg-status-warning-soft text-status-warning-foreground";
    case "success":
      return "border-status-completed/30 bg-status-completed-soft text-status-completed-foreground";
    default:
      return "border-border/70 bg-background/90 text-foreground";
  }
}

/**
 * Canvas status tip — single bottom-center chip.
 *
 * One message at a time (state replaces, never stacks). Solid chip background
 * so text never double-exposes against the canvas. Host should place this in
 * the bottom HUD stack so it cannot collide with the trajectory filmstrip.
 */
export const ViewerStatusOverlay: React.FC<ViewerStatusOverlayProps> = ({
  app,
  className,
  embedded = false,
}) => {
  const { activity, dismissActivity } = useStatusMessage(app);

  if (!activity.text) return null;

  const isAlert = activity.type === "error" || activity.type === "warning";
  const pct =
    activity.progress !== undefined && Number.isFinite(activity.progress)
      ? Math.max(0, Math.min(100, activity.progress))
      : null;

  const chip = (
    <div
      key={activity.pulse}
      className={cn(
        "inline-flex max-w-[min(36rem,calc(100vw-2rem))] min-w-0 flex-col gap-1",
        "rounded-full border px-3 py-1.5 shadow-sm backdrop-blur-md",
        "dark:shadow-sm",
        chipTone(activity.type),
      )}
    >
      <span className="inline-flex min-w-0 items-center justify-center gap-1.5 text-center text-label leading-snug">
        <ActivityIcon type={activity.type} progress={activity.progress} />
        <span className="min-w-0 truncate">{activity.text}</span>
      </span>
      {pct !== null && (
        <div
          className="mx-auto h-px w-full max-w-[12rem] bg-foreground/15"
          aria-hidden
        >
          <div
            className="h-px bg-accent/80 transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );

  const content = isAlert ? (
    <button
      type="button"
      className="pointer-events-auto max-w-full cursor-pointer border-0 bg-transparent p-0"
      title="Click to dismiss"
      onClick={dismissActivity}
    >
      {chip}
    </button>
  ) : (
    chip
  );

  return (
    <div
      role="status"
      aria-live={activity.type === "error" ? "assertive" : "polite"}
      className={cn(
        embedded
          ? "pointer-events-none flex w-full justify-center"
          : // Standalone: bottom center of the relative canvas host.
            "pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 safe-area-bottom",
        className,
      )}
    >
      {content}
    </div>
  );
};
