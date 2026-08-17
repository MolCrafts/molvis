import {
  AlertCircle,
  CircleCheck,
  CircleSlash2,
  Info,
  Loader2,
} from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

export type ViewerOperationPhase =
  | "loading"
  | "empty"
  | "error"
  | "disabled"
  | "running"
  | "success";

export interface ViewerOperationStateProps {
  phase: ViewerOperationPhase;
  message: string;
  detail?: string;
  action?: React.ReactNode;
  className?: string;
}

const PHASE = {
  loading: {
    Icon: Loader2,
    shell:
      "border-status-running/25 bg-status-running-soft text-status-running-foreground",
    icon: "animate-spin text-status-running",
  },
  running: {
    Icon: Loader2,
    shell:
      "border-status-running/25 bg-status-running-soft text-status-running-foreground",
    icon: "animate-spin text-status-running",
  },
  success: {
    Icon: CircleCheck,
    shell:
      "border-status-completed/25 bg-status-completed-soft text-status-completed-foreground",
    icon: "text-status-completed",
  },
  error: {
    Icon: AlertCircle,
    shell:
      "border-status-failed/25 bg-status-failed-soft text-status-failed-foreground",
    icon: "text-status-failed",
  },
  empty: {
    Icon: Info,
    shell: "border-border/70 bg-muted/30 text-muted-foreground",
    icon: "text-muted-foreground",
  },
  disabled: {
    Icon: CircleSlash2,
    shell: "border-border/70 bg-muted/30 text-muted-foreground",
    icon: "text-muted-foreground",
  },
} as const;

/**
 * Product-wide state surface for asynchronous viewer operations.
 *
 * UI phases map to the fixed MolCrafts status vocabulary: running/loading,
 * completed, failed, or neutral. Callers provide facts, never colors.
 */
export function ViewerOperationState({
  phase,
  message,
  detail,
  action,
  className,
}: ViewerOperationStateProps) {
  const { Icon, shell, icon } = PHASE[phase];
  const active = phase === "loading" || phase === "running";

  return (
    <div
      key={phase}
      role={phase === "error" ? "alert" : "status"}
      aria-live={phase === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-busy={active}
      className={cn(
        "motion-state-change flex items-start gap-2 rounded-control border px-2 py-2 text-micro leading-snug transition-colors duration-(--motion-base) ease-standard",
        shell,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-px size-3.5 shrink-0", icon)}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{message}</p>
        {detail && <p className="mt-1 opacity-80">{detail}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
