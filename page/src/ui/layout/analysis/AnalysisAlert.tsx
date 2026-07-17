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
    box: "border-warning/25 bg-warning-soft text-warning-foreground",
    icon: "text-warning",
    Icon: AlertCircle,
  },
  error: {
    box: "border-destructive/25 bg-destructive/10 text-destructive",
    icon: "text-destructive",
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
      className={cn(
        "mt-1.5 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-snug",
        box,
        className,
      )}
    >
      <Icon className={cn("mt-px h-3 w-3 shrink-0", icon)} />
      <span className="min-w-0">{children}</span>
    </p>
  );
};
