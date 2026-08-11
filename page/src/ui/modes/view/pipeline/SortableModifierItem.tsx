import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DataSource,
  ExpressionSelectionModifier,
  FileDataSource,
  MemoryDataSource,
  type Modifier,
  ModifierCapability,
  type PipelineEntry,
  SelectModifier,
  Session,
  StreamDataSource,
} from "@molcrafts/molvis-stage";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface SortableModifierItemProps {
  modifier: PipelineEntry;
  selected: boolean;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  /** First among siblings under the same parent (branch rail). */
  isFirstSibling?: boolean;
  /** Last among siblings under the same parent (branch rail). */
  isLastSibling?: boolean;
  /** Composition primary data source (first enabled DS). */
  isPrimary?: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onToggleExpand: () => void;
}

interface DisplayInfo {
  title: string;
  /** Secondary meta — multi-frame count, stream, selection summary, … */
  subtitle?: string;
}

function getDisplayInfo(modifier: PipelineEntry): DisplayInfo {
  if (modifier instanceof FileDataSource) {
    const title = modifier.filename || modifier.name || "Empty Scene";
    if (modifier.frameCount > 1) {
      return { title, subtitle: `${modifier.frameCount} frames` };
    }
    return { title };
  }
  if (modifier instanceof StreamDataSource) {
    return {
      title: modifier.filename || modifier.name || "Live stream",
      subtitle: "stream",
    };
  }
  if (modifier instanceof MemoryDataSource) {
    return {
      title: modifier.filename || modifier.name || "Empty Scene",
    };
  }
  if (modifier instanceof Session) {
    return {
      title: "Session",
      subtitle: modifier.address || undefined,
    };
  }
  if (modifier instanceof SelectModifier) {
    return {
      title: modifier.name || modifier.id,
      subtitle: modifier.selectionSummary || undefined,
    };
  }
  if (modifier instanceof ExpressionSelectionModifier) {
    return {
      title: modifier.selectionName || modifier.name || modifier.id,
      subtitle: modifier.expression || "empty expression",
    };
  }
  return { title: modifier.name };
}

function hasSelectionScope(entry: PipelineEntry): boolean {
  if (entry instanceof DataSource || entry instanceof Session) return false;
  const modifier = entry as Modifier;
  return (
    modifier.capabilities.has(ModifierCapability.ProducesSelection) ||
    modifier.selectionScopeId !== null
  );
}

/**
 * Pipeline row: expand + enable checkbox + label.
 * Type glyphs are omitted — hierarchy comes from source band vs step band.
 * Drag grip appears on hover without reserving a permanent column.
 */
export function SortableModifierItem({
  modifier,
  selected,
  depth,
  hasChildren,
  isExpanded,
  isFirstSibling = false,
  isLastSibling = false,
  isPrimary = false,
  onSelect,
  onToggle,
  onToggleExpand,
}: SortableModifierItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: modifier.id,
    transition: {
      duration: 150,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
  };

  const isSource =
    modifier instanceof DataSource || modifier instanceof Session;
  const dimmed = !modifier.enabled;
  const showScopeRail = hasSelectionScope(modifier);
  const { title, subtitle } = getDisplayInfo(modifier);
  const nested = depth > 0;
  const branchLeft = 18 + (depth - 1) * 12;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex min-w-0 select-none transition-colors duration-(--motion-fast) ease-standard",
        isSource
          ? "min-h-control items-center px-2 py-2"
          : "min-h-control-compact items-center px-2 py-1.5",
        isSource && !selected && "bg-muted/35",
        !isSource && !selected && "bg-background",
        selected && "bg-accent/14",
        !selected && isSource && "hover:bg-muted/50",
        !selected && !isSource && "hover:bg-interactive",
        isDragging && "opacity-60",
      )}
    >
      {selected && (
        <span className="pointer-events-none absolute inset-y-0 left-0 z-1 w-0.5 bg-accent" />
      )}
      {!selected && showScopeRail && (
        <span className="pointer-events-none absolute inset-y-0 left-0 z-1 w-0.5 bg-scope-rail" />
      )}

      {nested && (
        <>
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute w-px bg-border",
              isLastSibling ? "top-0 h-1/2" : "inset-y-0",
              isFirstSibling && !isLastSibling && "top-0 bottom-0",
            )}
            style={{ left: branchLeft }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-px w-2.5 bg-border"
            style={{ left: branchLeft }}
          />
        </>
      )}

      {/* Hover grip — absolute so it does not sit between chevron and checkbox. */}
      <button
        type="button"
        className={cn(
          "absolute top-1/2 left-0 z-2 flex h-5 w-4 -translate-y-1/2 cursor-grab items-center justify-center text-subtle-foreground transition-opacity duration-(--motion-fast) ease-standard active:cursor-grabbing",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          isDragging && "opacity-100",
        )}
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div
        className="flex min-w-0 flex-1 items-center gap-1.5"
        style={nested ? { paddingLeft: 12 + depth * 12 } : undefined}
      >
        {/* Chevron + checkbox as one tight control cluster. */}
        <div className="flex shrink-0 items-center gap-0.5">
          {hasChildren ? (
            <button
              type="button"
              className="flex h-5 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-interactive hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand();
              }}
              onPointerDown={(event) => event.stopPropagation()}
              aria-label={isExpanded ? "Collapse" : "Expand"}
              aria-expanded={isExpanded}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="h-5 w-4 shrink-0" aria-hidden />
          )}

          <div
            className="flex shrink-0 items-center justify-center"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Checkbox
              aria-label={`${title} enabled`}
              checked={modifier.enabled}
              onCheckedChange={() => onToggle()}
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        </div>

        <button
          type="button"
          className={cn(
            "min-w-0 flex-1 border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isSource && "py-0.5",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <span className="flex min-w-0 items-center gap-1.5 leading-snug">
            <span
              className={cn(
                "min-w-0 truncate",
                isSource ? "text-xs font-semibold tracking-tight" : "text-xs",
                selected && !isSource && "font-medium",
                dimmed
                  ? "text-subtle-foreground line-through decoration-1"
                  : "text-foreground",
              )}
            >
              {title}
            </span>
            {isPrimary ? (
              <span
                className="shrink-0 rounded-sm border border-border/80 bg-muted/50 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                title="Primary data source — Replace primary overwrites this; Add source augments"
              >
                Primary
              </span>
            ) : null}
          </span>
          {subtitle ? (
            <span
              className={cn(
                "mt-0.5 block truncate text-micro leading-none",
                dimmed ? "text-subtle-foreground/70" : "text-muted-foreground",
              )}
            >
              {subtitle}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
