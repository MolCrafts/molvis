import type React from "react";
import { cn } from "@/lib/utils";

interface AnalysisPanelShellProps {
  /** Params, shortcuts, run bar — top of the column. */
  controls: React.ReactNode;
  /** Result body — fills the rest and scrolls. */
  results?: React.ReactNode;
  className?: string;
}

/**
 * Unified compute column: operations on top, results below.
 *
 * Every compute panel (catalog, product, plugin) mounts through this shell
 * so a new panel only fills the two slots — it does not invent a layout.
 */
export const AnalysisPanelShell: React.FC<AnalysisPanelShellProps> = ({
  controls,
  results,
  className,
}) => (
  <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
    <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-border/70">
      <div className="space-y-2 px-2 py-2">{controls}</div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">{results}</div>
  </div>
);
