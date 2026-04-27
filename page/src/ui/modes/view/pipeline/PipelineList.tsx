import {
  loadFileSmart,
  useFormatPicker,
} from "@/components/format-picker-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  DataSourceModifier,
  type Modifier,
  ModifierRegistry,
  type Molvis,
} from "@molvis/core";
import { getAllAcceptExtensions } from "@molvis/core/io";
import { FilePlus2, Plus } from "lucide-react";
import { useMemo, useRef } from "react";
import { SortableModifierItem } from "./SortableModifierItem";
import { buildTree, flattenTree } from "./tree_utils";

interface PipelineListProps {
  app: Molvis | null;
  modifiers: Modifier[];
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelectModifier: (id: string) => void;
  onToggleModifier: (modifier: Modifier) => void;
  onRemoveModifier: (id: string) => void;
  onAddModifier: (factory: () => Modifier) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onToggleExpand: (id: string) => void;
  onDataSourceAdded?: () => void;
}

export function PipelineList({
  app,
  modifiers,
  selectedId,
  expandedIds,
  onSelectModifier,
  onToggleModifier,
  onRemoveModifier,
  onAddModifier,
  onDragEnd,
  onToggleExpand,
  onDataSourceAdded,
}: PipelineListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const pickFormat = useFormatPicker();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddDataSource = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file || !app) return;
    try {
      // Append a new DataSourceModifier alongside any existing ones.
      // First-load case (empty pipeline) falls through to "replace"
      // semantics inside loadFileSmart since there's nothing to append
      // to — picks the right branch automatically.
      const hasExistingDS = app.modifierPipeline
        .getModifiers()
        .some((m) => m instanceof DataSourceModifier);
      const mode = hasExistingDS ? "append" : "replace";
      const result = await loadFileSmart(app, file, pickFormat, mode);
      if (result === "started") onDataSourceAdded?.();
    } finally {
      e.target.value = "";
    }
  };

  const tree = useMemo(() => buildTree(modifiers), [modifiers]);
  const flatNodes = useMemo(
    () => flattenTree(tree, expandedIds),
    [tree, expandedIds],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScrollArea className="flex-1 bg-background">
        <div className="flex flex-col">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={flatNodes.map((n) => n.modifier.id)}
              strategy={verticalListSortingStrategy}
            >
              {flatNodes.map((node) => (
                <SortableModifierItem
                  key={node.modifier.id}
                  modifier={node.modifier}
                  selected={selectedId === node.modifier.id}
                  depth={node.depth}
                  hasChildren={node.children.length > 0}
                  isExpanded={expandedIds.has(node.modifier.id)}
                  onSelect={() => onSelectModifier(node.modifier.id)}
                  onToggle={() => onToggleModifier(node.modifier)}
                  onRemove={() => onRemoveModifier(node.modifier.id)}
                  onToggleExpand={() => onToggleExpand(node.modifier.id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          <div className="p-1.5 border-t flex gap-1.5">
            <div className="relative flex-1">
              <input
                ref={fileInputRef}
                type="file"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handleAddDataSource}
                accept={getAllAcceptExtensions()}
                title="Add Data Source"
                aria-label="Add Data Source"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full border border-dashed text-muted-foreground"
                title="Add Data Source"
                aria-label="Add Data Source"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 flex-1 border border-dashed text-muted-foreground"
                  title="Add modifier"
                  aria-label="Add modifier"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="center"
                className="min-w-[160px] max-w-[220px]"
              >
                {ModifierRegistry.getAvailableModifiers().map((entry) => (
                  <DropdownMenuItem
                    key={entry.name}
                    className="text-xs"
                    onClick={() => onAddModifier(entry.factory)}
                  >
                    {entry.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
