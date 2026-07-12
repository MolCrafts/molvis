import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ExpressionSelectionModifier,
  FileDataSource,
  MemoryDataSource,
  type Modifier,
  ModifierCapability,
  primaryCapabilityLabel,
  SelectModifier,
} from "@molvis/core";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Database,
  Eye,
  Filter,
  GripVertical,
  type LucideIcon,
  SquareDashed,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface SortableModifierItemProps {
  modifier: Modifier;
  selected: boolean;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onToggleExpand: () => void;
}

function getDisplayName(modifier: Modifier): string {
  if (modifier instanceof FileDataSource) {
    if (modifier.sourceType === "empty") return "Empty Scene";
    const label = modifier.filename || modifier.name;
    return `${label} · ${modifier.frameCount} frame${modifier.frameCount === 1 ? "" : "s"}`;
  }
  if (modifier instanceof MemoryDataSource) {
    if (modifier.sourceType === "empty") return "Empty Scene";
    const label = modifier.filename || modifier.name;
    return `${label} · 1 frame`;
  }
  if (modifier instanceof SelectModifier) {
    return `${modifier.id} · ${modifier.selectionSummary}`;
  }
  if (modifier instanceof ExpressionSelectionModifier) {
    const expr = modifier.expression;
    const label = modifier.selectionName || modifier.id;
    return `${label} · ${expr || "empty"}`;
  }
  return modifier.name;
}

/**
 * Pick a glyph for a pipeline row. Data sources get their own mark; every
 * other modifier is grouped by its primary capability so a long stack scans
 * at a glance (select · transform · draw) instead of a column of identical
 * checkboxes.
 */
function getModifierIcon(modifier: Modifier): LucideIcon {
  if (
    modifier instanceof FileDataSource ||
    modifier instanceof MemoryDataSource
  )
    return Database;
  switch (primaryCapabilityLabel(modifier.capabilities)) {
    case ModifierCapability.Draws:
      return Eye;
    case ModifierCapability.ProducesSelection:
      return SquareDashed;
    case ModifierCapability.ConsumesSelection:
      return Filter;
    case ModifierCapability.TransformsData:
      return Wand2;
    default:
      return Circle;
  }
}

const SCOPE_COLORS = [
  "#2563EB",
  "#DC2626",
  "#16A34A",
  "#D97706",
  "#7C3AED",
  "#0891B2",
  "#DB2777",
  "#4D7C0F",
];

function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return SCOPE_COLORS[hash % SCOPE_COLORS.length];
}

function selectionRailColor(modifier: Modifier): string | null {
  if (modifier.capabilities.has(ModifierCapability.ProducesSelection)) {
    return colorForId(modifier.id);
  }
  if (modifier.selectionScopeId) return colorForId(modifier.selectionScopeId);
  return null;
}

export function SortableModifierItem({
  modifier,
  selected,
  depth,
  hasChildren,
  isExpanded,
  onSelect,
  onToggle,
  onRemove,
  onToggleExpand,
}: SortableModifierItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: modifier.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    paddingLeft: `${depth * 14 + 8}px`,
  };

  const Icon = getModifierIcon(modifier);
  const dimmed = !modifier.enabled;
  const scopeColor = selectionRailColor(modifier);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex items-center gap-1.5 py-1 pr-1 border-b last:border-0 text-xs select-none transition-colors",
        selected ? "bg-accent/70" : "hover:bg-accent/30",
        isDragging && "opacity-60",
      )}
    >
      {scopeColor && (
        <span
          className="pointer-events-none absolute left-0 inset-y-0 w-1"
          style={{ backgroundColor: scopeColor }}
        />
      )}
      {selected && (
        <span className="pointer-events-none absolute left-1 inset-y-0 w-0.5 bg-primary" />
      )}

      {hasChildren ? (
        <button
          type="button"
          className="flex items-center justify-center w-3.5 h-3.5 text-muted-foreground hover:text-foreground shrink-0"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand();
          }}
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}

      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex h-4 w-4 items-center justify-center cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label="Drag to reorder"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-center justify-center shrink-0">
        <Checkbox
          checked={modifier.enabled}
          onCheckedChange={() => onToggle()}
          onClick={(event) => {
            event.stopPropagation();
          }}
        />
      </div>

      <button
        type="button"
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm border-0 bg-transparent p-0 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          selected && "font-medium",
        )}
        onClick={onSelect}
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-colors",
            dimmed ? "text-muted-foreground/40" : "text-muted-foreground",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            dimmed
              ? "text-muted-foreground/60 line-through decoration-1"
              : "text-foreground",
          )}
        >
          {getDisplayName(modifier)}
        </span>
      </button>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive transition-opacity",
          selected
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        title="Remove modifier"
        aria-label="Remove modifier"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
