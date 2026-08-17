import { AlertCircle, Info } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

export type AnalysisAlertTone = "info" | "warning" | "error";

const TONE: Record<
  AnalysisAlertTone,
  { box: string; icon: string; Icon: typeof Info }
> = {
  info: {
    box: "border-border/70 bg-muted/30 text-muted-foreground",
    icon: "text-muted-foreground",
    Icon: Info,
  },
  warning: {
    box: "border-status-warning/25 bg-status-warning-soft text-status-warning-foreground",
    icon: "text-status-warning",
    Icon: AlertCircle,
  },
  error: {
    box: "border-status-failed/25 bg-status-failed-soft text-status-failed-foreground",
    icon: "text-status-failed-foreground",
    Icon: AlertCircle,
  },
};

interface AnalysisAlertProps {
  tone?: AnalysisAlertTone;
  children: React.ReactNode;
  className?: string;
}

/** Compact callout using semantic theme tokens (no raw amber/red classes). */
export const AnalysisAlert: React.FC<AnalysisAlertProps> = ({
  tone = "info",
  children,
  className,
}) => {
  const { box, icon, Icon } = TONE[tone];
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      className={cn(
        "mt-2 flex items-start gap-2 rounded-md border px-2 py-2 text-micro leading-snug",
        box,
        className,
      )}
    >
      <Icon className={cn("mt-px h-3 w-3 shrink-0", icon)} />
      <span className="min-w-0">{children}</span>
    </p>
  );
};
