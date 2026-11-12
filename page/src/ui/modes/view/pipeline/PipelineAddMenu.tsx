import {
  AddRegular as Plus,
  SearchRegular as Search,
} from "@fluentui/react-icons";
import type { LoadMode } from "@molcrafts/molvis-stage/io";
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
} from "@molcrafts/ui";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  type AvailableModifier,
  buildPipelineAddItems,
  filterPipelineAddItems,
  groupPipelineAddItems,
  type PipelineAddItem,
} from "./pipeline_menu";

interface PipelineAddMenuProps {
  modifiers: readonly AvailableModifier[];
  hasSources: boolean;
  wrapEnabled: boolean;
  onOpenFile: (mode: LoadMode) => void;
  onStream: () => void;
  onAddModifier: (name: string) => void;
  onToggleWrap: (enabled: boolean) => void;
}

/**
 * Compact searchable add catalog — same row density as the canvas context
 * menu (28px rows, accent hover, check · label track). Nested flyouts are
 * replaced by one list with a search field so Wrap PBC is type-reachable.
 */
export function PipelineAddMenu({
  modifiers,
  hasSources,
  wrapEnabled,
  onOpenFile,
  onStream,
  onAddModifier,
  onToggleWrap,
}: PipelineAddMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const items = useMemo(
    () => buildPipelineAddItems({ modifiers, hasSources, wrapEnabled }),
    [modifiers, hasSources, wrapEnabled],
  );
  const filtered = useMemo(
    () => filterPipelineAddItems(items, query),
    [items, query],
  );
  const sections = useMemo(() => groupPipelineAddItems(filtered), [filtered]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const activate = (item: PipelineAddItem) => {
    if (item.disabled) return;
    switch (item.kind) {
      case "open":
        onOpenFile("replace");
        break;
      case "add-source":
        onOpenFile("augment");
        break;
      case "extend":
        onOpenFile("extend");
        break;
      case "stream":
        onStream();
        break;
      case "modifier":
        if (item.modifierName) onAddModifier(item.modifierName);
        break;
      case "wrap":
        onToggleWrap(!wrapEnabled);
        break;
    }
    close();
  };

  const firstEnabled = filtered.find((item) => !item.disabled);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Add"
          aria-label="Add source or modifier"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <Plus />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-pipeline-menu-max p-1"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const root = event.currentTarget as HTMLElement;
          root
            .querySelector<HTMLInputElement>("[data-pipeline-add-search]")
            ?.focus();
        }}
      >
        <div className="relative px-1 pb-1 pt-0.5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-pipeline-add-search
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search…"
            aria-label="Search pipeline menu"
            className="h-control-compact border-0 bg-transparent pl-7 pr-2 text-label shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (event.key === "Enter" && query.trim() && firstEnabled) {
                event.preventDefault();
                activate(firstEnabled);
              }
            }}
          />
        </div>
        <div className="mx-1 mb-1 h-px bg-border" />
        <ScrollArea className="h-pipeline-add-list">
          <div role="menu" aria-label="Pipeline add menu" className="p-0.5">
            {sections.length === 0 && (
              <p className="px-2 py-4 text-center text-micro text-muted-foreground">
                No matches for “{query.trim()}”.
              </p>
            )}
            {sections.map(({ group, items: rows }) => (
              <div key={group} className="mb-0.5">
                <div className="px-2 py-1 text-micro text-muted-foreground">
                  {group}
                </div>
                {rows.map((item) => (
                  <AddMenuRow
                    key={item.id}
                    item={item}
                    searching={query.trim().length > 0}
                    onActivate={activate}
                  />
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function AddMenuRow({
  item,
  searching,
  onActivate,
}: {
  item: PipelineAddItem;
  searching: boolean;
  onActivate: (item: PipelineAddItem) => void;
}) {
  const isCheck = item.kind === "wrap";
  return (
    <Button
      role="menuitem"
      aria-disabled={item.disabled || undefined}
      disabled={item.disabled}
      title={
        item.disabled
          ? `${item.label} is not applicable to the current frame`
          : undefined
      }
      onClick={() => onActivate(item)}
      variant="ghost"
      size="content"
      className={cn(
        "group grid h-control-compact w-full min-h-control-compact items-center gap-1 px-2 text-left text-body font-normal",
        "grid-cols-[1.25rem_minmax(0,1fr)_auto]",
        item.disabled
          ? "cursor-default opacity-40"
          : "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
      )}
    >
      <span className="text-center text-label leading-none" aria-hidden>
        {isCheck && item.checked ? "✓" : ""}
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
      <span className="justify-self-end text-micro text-muted-foreground group-hover:text-inherit group-focus-visible:text-inherit">
        {searching ? item.group : ""}
      </span>
    </Button>
  );
}
