import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AssignColorModifier,
  ColorByPropertyModifier,
  ComputeBondsModifier,
  DataSource,
  DrawAtomModifier,
  DrawBondModifier,
  DrawBoxModifier,
  DrawIsosurfaceModifier,
  DrawRibbonModifier,
  ExpressionSelectionModifier,
  FileDataSource,
  HideHydrogensModifier,
  HideSelectionModifier,
  MemoryDataSource,
  type Modifier,
  ModifierCapability,
  type PipelineEntry,
  SelectModifier,
  Session,
  SliceModifier,
} from "@molcrafts/molvis-stage";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Circle,
  Database,
  Droplets,
  Eye,
  Filter,
  GripVertical,
  Layers,
  Link2,
  type LucideIcon,
  Palette,
  Scissors,
  Server,
  SquareDashed,
  Trash2,
  Wand2,
  Waves,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { cn } from "@/lib/utils";

interface SortableModifierItemProps {
  modifier: PipelineEntry;
  selected: boolean;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onToggleExpand: () => void;
}

function getDisplayName(modifier: PipelineEntry): string {
  if (modifier instanceof FileDataSource) {
    const label = modifier.filename || modifier.name || "Empty Scene";
    return `${label} · ${modifier.frameCount} frame${modifier.frameCount === 1 ? "" : "s"}`;
  }
  if (modifier instanceof MemoryDataSource) {
    // Boot primary uses filename "Empty Scene"; demo/sketch may rename it.
    const label = modifier.filename || modifier.name || "Empty Scene";
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
 * Prefer type-specific glyphs; fall back to capability family so a long
 * stack scans at a glance without reading every label.
 */
function getModifierIcon(modifier: PipelineEntry): LucideIcon {
  if (
    modifier instanceof FileDataSource ||
    modifier instanceof MemoryDataSource
  )
    return Database;
  if (modifier instanceof DrawAtomModifier) return Circle;
  if (modifier instanceof DrawBondModifier) return Link2;
  if (modifier instanceof DrawBoxModifier) return Box;
  if (modifier instanceof DrawRibbonModifier) return Waves;
  if (modifier instanceof DrawIsosurfaceModifier) return Layers;
  if (
    modifier instanceof ColorByPropertyModifier ||
    modifier instanceof AssignColorModifier
  )
    return Palette;
  if (modifier instanceof HideHydrogensModifier) return Droplets;
  if (modifier instanceof HideSelectionModifier) return Eye;
  if (modifier instanceof SliceModifier) return Scissors;
  if (modifier instanceof ComputeBondsModifier) return Link2;
  if (
    modifier instanceof SelectModifier ||
    modifier instanceof ExpressionSelectionModifier
  )
    return SquareDashed;
  if (modifier instanceof Session) return Server;
  if (modifier instanceof DataSource) return Database;
  // Fallback for unknown / plugin modifiers: family icon only, no text badge.
  const caps = (modifier as Modifier).capabilities;
  if (caps.has(ModifierCapability.Draws)) return Eye;
  if (caps.has(ModifierCapability.ProducesSelection)) return SquareDashed;
  if (caps.has(ModifierCapability.ConsumesSelection)) return Filter;
  if (caps.has(ModifierCapability.TransformsData)) return Wand2;
  return Circle;
}

function hasSelectionScope(entry: PipelineEntry): boolean {
  // A source produces no selection and consumes none — no scope to show.
  if (entry instanceof DataSource) return false;
  const modifier = entry as Modifier;
  return (
    modifier.capabilities.has(ModifierCapability.ProducesSelection) ||
    modifier.selectionScopeId !== null
  );
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
    paddingLeft: `${depth * 14 + 8}px`,
  };

  const Icon = getModifierIcon(modifier);
  const dimmed = !modifier.enabled;
  const showScopeRail = hasSelectionScope(modifier);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex min-w-0 items-center gap-1.5 border-b py-1 pr-1 text-xs last:border-0 select-none transition-colors duration-(--motion-fast) ease-standard",
        selected ? "bg-accent/15" : "hover:bg-interactive",
        isDragging && "opacity-60",
      )}
    >
      {showScopeRail && (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-scope-rail" />
      )}
      {selected && (
        <span className="pointer-events-none absolute inset-y-0 left-1 w-1 bg-accent" />
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
        className="flex h-4 w-4 items-center justify-center cursor-grab text-subtle-foreground group-hover:text-muted-foreground shrink-0 transition-colors duration-(--motion-fast) ease-standard focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label="Drag to reorder"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-center justify-center shrink-0">
        <Checkbox
          aria-label={`${getDisplayName(modifier)} enabled`}
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
          "flex min-w-0 flex-1 items-center gap-2 rounded-sm border-0 bg-transparent p-0 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          selected && "font-medium",
        )}
        onClick={onSelect}
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-colors duration-(--motion-fast) ease-standard",
            dimmed ? "text-subtle-foreground" : "text-muted-foreground",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            dimmed
              ? "text-subtle-foreground line-through decoration-1"
              : "text-foreground",
          )}
        >
          {getDisplayName(modifier)}
        </span>
      </button>

      <ViewerIconAction
        icon={<Trash2 />}
        label="Remove modifier"
        tooltipSide="left"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      />
    </div>
  );
}
