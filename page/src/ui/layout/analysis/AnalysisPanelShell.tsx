import type React from "react";
import { cn } from "@/lib/utils";

interface AnalysisPanelShellProps {
  /** Scrollable body: scope, parameters, results. */
  children: React.ReactNode;
  /** Fixed footer, typically {@link AnalysisRunBar}. */
  footer: React.ReactNode;
  className?: string;
}

/**
 * Fills the analysis column: body scrolls; footer is pinned to the true bottom
 * of the side panel (not mid-content sticky).
 */
export const AnalysisPanelShell: React.FC<AnalysisPanelShellProps> = ({
  children,
  footer,
  className,
}) => (
  <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
    <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    <div className="shrink-0">{footer}</div>
  </div>
);
