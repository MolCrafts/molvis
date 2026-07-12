import { type AnalysisDefinition, stripCode } from "@molvis/core";
import { Check, ChevronDown, Search } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
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
        <Button
          variant="outline"
          disabled={!enabled}
          className="h-7 flex-1 min-w-0 justify-between px-2 text-xs font-normal"
          aria-label="Analysis type"
          aria-expanded={enabled && open}
          aria-busy={probing}
          title={
            probing
              ? "Checking requirements against loaded data…"
              : enabled
                ? "Choose analysis"
                : "Load a structure or trajectory first"
          }
        >
          <span className="truncate">
            {probing
              ? "Checking data…"
              : enabled
                ? (selected?.label ?? "Choose analysis")
                : "Load data first"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))] p-0"
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
              placeholder="Search analyses…"
              className="h-8 pl-7 text-xs"
              aria-label="Search analyses"
            />
          </div>
          <p className="mt-1.5 px-0.5 text-[10px] tabular-nums text-muted-foreground">
            {runnable}/{total} available
            {query.trim()
              ? ` · ${filtered.reduce((n, g) => n + g.entries.length, 0)} match`
              : ""}
          </p>
        </div>

        <ScrollArea className="h-[min(22rem,50vh)]">
          <div className="p-1">
            {filtered.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No analyses match “{query.trim()}”.
              </p>
            )}
            {filtered.map(({ category, entries }) => (
              <div key={category.id} className="mb-1">
                <div className="sticky top-0 z-[1] bg-popover px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {category.label}
                  <span className="ml-1.5 font-normal tabular-nums normal-case tracking-normal">
                    {entries.filter((e) => !e.blockedReason).length}/
                    {entries.length}
                  </span>
                </div>
                <ul className="flex flex-col gap-0.5">
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
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                            blocked
                              ? "cursor-not-allowed opacity-50"
                              : "hover:bg-muted/40",
                            active &&
                              !blocked &&
                              "bg-accent text-accent-foreground",
                          )}
                        >
                          <Check
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              active ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                            <span className="truncate font-medium">
                              {analysis.label}
                            </span>
                            {blocked && showBlockedReasons && (
                              <span className="whitespace-normal text-[10px] leading-tight text-muted-foreground">
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
