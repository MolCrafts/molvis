import { ChartLine, Download, Table2 } from "lucide-react";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { AnalysisAlert } from "./AnalysisAlert";

interface ResultSectionProps {
  /** Section subtitle (frame count, bins, …). */
  subtitle?: string;
  /** When true, show an "outdated" badge — params/scope changed since last run. */
  stale?: boolean;
  /** Optional CSV/export handler shown in the header row. */
  onExport?: () => void;
  exportLabel?: string;
  /** Failures / skipped frames note. */
  failures?: number;
  /** Chart pane (required when using tabs). */
  chart?: React.ReactNode;
  /** Data/table pane; when omitted, only chart (or children) is shown. */
  data?: React.ReactNode;
  /** Fallback single body when not using chart/data tabs. */
  children?: React.ReactNode;
  defaultOpen?: boolean;
}

function IconTipButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="h-7 w-7 border-0 p-0 shadow-none"
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Shared Result block: optional Chart | Data tabs, export, stale + failures.
 */
export const ResultSection: React.FC<ResultSectionProps> = ({
  subtitle,
  stale = false,
  onExport,
  exportLabel = "Export CSV",
  failures = 0,
  chart,
  data,
  children,
  defaultOpen = true,
}) => {
  const useTabs = chart !== undefined && data !== undefined;

  return (
    <SidebarSection
      title="Result"
      subtitle={
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {subtitle && <span className="truncate">{subtitle}</span>}
          {stale && (
            <Badge
              variant="outline"
              className="h-4 shrink-0 rounded-sm px-1 text-[9px] font-medium uppercase tracking-wide text-warning-foreground border-warning/30 bg-warning-soft"
            >
              outdated
            </Badge>
          )}
        </span>
      }
      defaultOpen={defaultOpen}
    >
      {stale && (
        <AnalysisAlert tone="warning" className="mt-0 mb-1.5">
          Parameters or scope changed — re-run to refresh this result.
        </AnalysisAlert>
      )}

      {useTabs ? (
        <Tabs defaultValue="chart" className="w-full gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <TabsList className="h-7" variant="default">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="chart"
                    className="px-2"
                    aria-label="Chart"
                  >
                    <ChartLine className="h-3.5 w-3.5" />
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Chart</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="data" className="px-2" aria-label="Data">
                    <Table2 className="h-3.5 w-3.5" />
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Data</TooltipContent>
              </Tooltip>
            </TabsList>
            {onExport && (
              <IconTipButton label={exportLabel} onClick={onExport}>
                <Download className="h-3.5 w-3.5" />
              </IconTipButton>
            )}
          </div>
          <TabsContent value="chart" className="mt-0">
            {chart}
          </TabsContent>
          <TabsContent value="data" className="mt-0">
            {data}
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {onExport && (
            <div className="mb-1.5 flex justify-end">
              <IconTipButton label={exportLabel} onClick={onExport}>
                <Download className="h-3.5 w-3.5" />
              </IconTipButton>
            </div>
          )}
          {chart ?? children}
        </>
      )}

      {failures > 0 && (
        <AnalysisAlert tone="info" className="mt-1.5">
          {failures} frame{failures === 1 ? "" : "s"} skipped
        </AnalysisAlert>
      )}
    </SidebarSection>
  );
};
