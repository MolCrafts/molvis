import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ExpressionSelectionModifier,
  FrameDataSource,
  type Modifier,
  SelectModifier,
  TrajectoryDataSource,
} from "@molvis/core";
import { ChevronDown, ChevronRight, GripVertical, Trash2 } from "lucide-react";

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
  if (modifier instanceof TrajectoryDataSource) {
    const label = modifier.filename || modifier.name;
    return `${label} · Trajectory · ${modifier.frameCount} frame${modifier.frameCount === 1 ? "" : "s"}`;
  }
  if (modifier instanceof FrameDataSource) {
    const label = modifier.filename || modifier.name;
    return `${label} · Topology · 1 frame`;
  }
  if (modifier instanceof SelectModifier) {
    return `${modifier.id} · ${modifier.selectionSummary}`;
  }
  if (modifier instanceof ExpressionSelectionModifier) {
    const expr = modifier.expression;
    return `${modifier.id} · ${expr || "empty"}`;
  }
  return modifier.name;
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
    paddingLeft: `${depth * 14 + 4}px`,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 py-1 pr-1 border-b last:border-0 text-xs select-none ${selected ? "bg-accent/80" : "bg-background hover:bg-accent/30"} ${isDragging ? "opacity-50" : ""}`}
      onClick={onSelect}
      {...attributes}
    >
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

      <div
        {...listeners}
        className="cursor-grab text-muted-foreground hover:text-foreground shrink-0"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>

      <div className="flex items-center justify-center shrink-0">
        <Checkbox
          checked={modifier.enabled}
          onCheckedChange={() => onToggle()}
          onClick={(event) => {
            event.stopPropagation();
          }}
        />
      </div>

      <span className="flex-1 min-w-0 font-medium truncate cursor-default">
        {getDisplayName(modifier)}
      </span>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
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
