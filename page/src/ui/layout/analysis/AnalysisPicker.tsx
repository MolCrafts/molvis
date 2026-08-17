import { type AnalysisDefinition, stripCode } from "@molcrafts/molvis-stage";
import { Check, ChevronDown, Search } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { cn } from "@/lib/utils";
import { InlineCode } from "./InlineCode";

export interface PickerEntry {
  analysis: AnalysisDefinition;
  /** Unmet-requirement reason, shown under a disabled item. */
  blockedReason?: string;
}

export interface PickerGroup {
  category: { id: string; label: string };
  entries: PickerEntry[];
}

interface AnalysisPickerProps {
  groups: PickerGroup[];
  selected: AnalysisDefinition | undefined;
  onSelect: (analysisId: string) => void;
  /**
   * Render each blocked item's reason inline. Suppressed when no frame is
   * loaded, where every reason is the same and repeating it is noise.
   */
  showBlockedReasons?: boolean;
  /** When false, the catalog cannot be opened (no structure loaded). */
  enabled?: boolean;
  /** True while requirements are being re-probed against loaded data. */
  probing?: boolean;
  /** Drop outline frame on the trigger (toolbar density). */
  borderless?: boolean;
}

/**
 * Searchable flat catalog of analyses, grouped by molrs compute category.
 * Replaces nested dropdown submenus which are awkward in a narrow sidebar.
 */
export const AnalysisPicker: React.FC<AnalysisPickerProps> = ({
  groups,
  selected,
  onSelect,
  showBlockedReasons = true,
  enabled = true,
  probing = false,
  borderless = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(({ category, entries }) => ({
        category,
        entries: entries.filter(({ analysis }) => {
          const hay =
            `${analysis.label} ${analysis.id} ${category.label}`.toLowerCase();
          return hay.includes(q);
        }),
      }))
      .filter((g) => g.entries.length > 0);
  }, [groups, query]);

  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  const runnable = groups.reduce(
    (n, g) => n + g.entries.filter((e) => !e.blockedReason).length,
    0,
  );

  return (
    <Popover
      open={enabled && open}
      onOpenChange={(next) => {
        if (!enabled) return;
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <ViewerAction
          purpose="dismiss"
          disabled={!enabled}
          className={cn(
            "min-w-0 flex-1 justify-between",
            borderless &&
              "border-0 bg-transparent shadow-none hover:bg-interactive focus-visible:border-0 focus-visible:ring-0",
          )}
          aria-label="Compute type"
          aria-expanded={enabled && open}
          aria-busy={probing}
          title={
            probing
              ? "Checking requirements against loaded data…"
              : enabled
                ? "Choose compute"
                : "Load a structure or trajectory first"
          }
        >
          <span className="truncate">
            {probing
              ? "Checking data…"
              : enabled
                ? (selected?.label ?? "Choose compute")
                : "Load data first"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </ViewerAction>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-analysis-picker p-0",
          borderless && "border-0 shadow-overlay",
        )}
        onOpenAutoFocus={(e) => {
          // Keep focus on the search field for typeahead.
          e.preventDefault();
          const root = e.currentTarget as HTMLElement;
          root
            .querySelector<HTMLInputElement>("[data-analysis-search]")
            ?.focus();
        }}
      >
        <div className="border-b border-border/70 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-analysis-search
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search computes…"
              className="h-control-compact pl-8 text-xs"
              aria-label="Search computes"
            />
          </div>
          <p className="mt-2 px-1 text-micro tabular-nums text-muted-foreground">
            {runnable}/{total} available
            {query.trim()
              ? ` · ${filtered.reduce((n, g) => n + g.entries.length, 0)} match`
              : ""}
          </p>
        </div>

        <ScrollArea className="h-analysis-list">
          <div className="p-1">
            {filtered.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No computes match “{query.trim()}”.
              </p>
            )}
            {filtered.map(({ category, entries }) => (
              <div key={category.id} className="mb-1">
                <div className="sticky top-0 z-[1] bg-popover px-2 py-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  {category.label}
                  <span className="ml-2 font-normal tabular-nums normal-case tracking-normal">
                    {entries.filter((e) => !e.blockedReason).length}/
                    {entries.length}
                  </span>
                </div>
                <ul className="flex flex-col gap-1">
                  {entries.map(({ analysis, blockedReason }) => {
                    const blocked = blockedReason !== undefined;
                    const active = selected?.id === analysis.id;
                    return (
                      <li key={analysis.id}>
                        <button
                          type="button"
                          disabled={blocked}
                          title={
                            blocked
                              ? `Unavailable — ${stripCode(blockedReason)}`
                              : undefined
                          }
                          onClick={() => {
                            if (blocked) return;
                            onSelect(analysis.id);
                            setOpen(false);
                            setQuery("");
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors duration-(--motion-fast) ease-standard",
                            blocked
                              ? "cursor-not-allowed opacity-50"
                              : "hover:bg-muted/40",
                            active &&
                              !blocked &&
                              "bg-accent/15 text-foreground",
                          )}
                        >
                          <Check
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              active ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="min-w-0 flex-1 flex flex-col gap-1">
                            <span className="truncate font-medium">
                              {analysis.label}
                            </span>
                            {blocked && showBlockedReasons && (
                              <span className="whitespace-normal text-micro leading-tight text-muted-foreground">
                                <InlineCode text={blockedReason} />
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
