import { useBondMappingPicker } from "@/components/bond-column-mapping-dialog";
import {
  loadFileSmart,
  useFormatPicker,
} from "@/components/format-picker-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { type Modifier, ModifierRegistry, type Molvis } from "@molvis/core";
import { getAllAcceptExtensions } from "@molvis/core/io";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
}: PipelineListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const pickFormat = useFormatPicker();
  const pickBondMapping = useBondMappingPicker();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Always append: the first DS in an empty pipeline becomes the
  // primary trajectory via app.addDataSource — no special "first-load
  // replace" branch needed. Replacement = remove existing DS + add new.
  const handleDataSourceFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file || !app) return;
    try {
      await loadFileSmart(app, file, pickFormat, "append", pickBondMapping);
    } finally {
      e.target.value = "";
    }
  };

  const tree = useMemo(() => buildTree(modifiers), [modifiers]);
  const flatNodes = useMemo(
    () => flattenTree(tree, expandedIds),
    [tree, expandedIds],
  );

  // Bump on every frame-change so the manual-add picker re-evaluates
  // each entry's `isApplicable(currentFrame)`. Without this the picker
  // would freeze its applicability snapshot at first render.
  const [frameVersion, setFrameVersion] = useState(0);
  useEffect(() => {
    if (!app) return;
    const bump = () => setFrameVersion((v) => v + 1);
    bump();
    const unsub = app.events.on("frame-change", bump);
    return () => {
      app.events.off("frame-change", bump);
      unsub?.();
    };
  }, [app]);

  // Probe each registered modifier against the current frame to decide
  // whether the manual-add picker should render it as enabled. Done as
  // a memo because `isApplicable()` may scan column data (e.g. the
  // BackboneRibbon CA scan), which we don't want to re-run per render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: frameVersion is the cache-busting signal — app.frame may keep the same reference while content changes underneath.
  const availableEntries = useMemo(() => {
    const frame = app?.frame ?? null;
    return ModifierRegistry.getAvailableModifiers().map((entry) => {
      // No frame loaded → don't gate. A user staging a pipeline before
      // loading data should still see every option.
      if (!frame) return { entry, applicable: true };
      try {
        const probe = entry.factory();
        return { entry, applicable: probe.isApplicable(frame) };
      } catch {
        return { entry, applicable: true };
      }
    });
  }, [app, frameVersion]);

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

          <div className="p-1.5 border-t">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleDataSourceFile}
              accept={getAllAcceptExtensions()}
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full border border-dashed text-muted-foreground"
                  title="Add"
                  aria-label="Add"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="center"
                className="min-w-[180px] max-w-[240px]"
              >
                <DropdownMenuItem
                  className="text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Data source…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {availableEntries.map(({ entry, applicable }) => (
                  <DropdownMenuItem
                    key={entry.name}
                    className="text-xs"
                    disabled={!applicable}
                    onClick={() => onAddModifier(entry.factory)}
                    title={
                      applicable
                        ? undefined
                        : `${entry.name} is not applicable to the current frame`
                    }
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
