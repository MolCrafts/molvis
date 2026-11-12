import { ArrowDownloadRegular as Download } from "@fluentui/react-icons";
import {
  Callout,
  IconAction,
  InspectorSection,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@molcrafts/ui";
import type React from "react";

interface ResultSectionProps {
  /** When true, show an "outdated" alert — params/scope changed since last run. */
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

/**
 * Shared Result block: Chart | Data line tabs, export, stale + failures.
 */
export const ResultSection: React.FC<ResultSectionProps> = ({
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
    <InspectorSection title="Result" defaultOpen={defaultOpen}>
      {stale && (
        <Callout tone="warning" className="mt-0 mb-2">
          Parameters or scope changed — re-run to refresh this result.
        </Callout>
      )}

      {useTabs ? (
        <Tabs defaultValue="chart" className="w-full gap-0">
          <div className="mb-2 flex h-control-compact items-end justify-between gap-2 border-b border-border">
            <TabsList
              variant="line"
              className="h-full min-w-0 flex-1 items-stretch justify-start gap-0 rounded-none bg-transparent p-0"
            >
              <TabsTrigger
                value="chart"
                className="h-full flex-none rounded-none px-2.5 text-micro after:inset-x-0 after:bottom-0 after:h-px group-data-[orientation=horizontal]/tabs:after:bottom-0 group-data-[orientation=horizontal]/tabs:after:h-px"
              >
                Chart
              </TabsTrigger>
              <TabsTrigger
                value="data"
                className="h-full flex-none rounded-none px-2.5 text-micro after:inset-x-0 after:bottom-0 after:h-px group-data-[orientation=horizontal]/tabs:after:bottom-0 group-data-[orientation=horizontal]/tabs:after:h-px"
              >
                Data
              </TabsTrigger>
            </TabsList>
            {onExport && (
              <IconAction
                icon={<Download />}
                label={exportLabel}
                onClick={onExport}
                className="mb-0.5"
              />
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
            <div className="mb-2 flex justify-end">
              <IconAction
                icon={<Download />}
                label={exportLabel}
                onClick={onExport}
              />
            </div>
          )}
          {chart ?? children}
        </>
      )}

      {failures > 0 && (
        <Callout tone="info" className="mt-2">
          {failures} frame{failures === 1 ? "" : "s"} skipped
        </Callout>
      )}
    </InspectorSection>
  );
};
