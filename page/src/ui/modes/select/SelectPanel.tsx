import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ExpressionSelectionModifier,
  isSelectionProducer,
  type Modifier,
  type Molvis,
} from "@molcrafts/molvis-stage";
import { Check, Code2, GripVertical, Lasso, Minus, Plus } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { ViewerToggleAction } from "@/components/viewer/ViewerToggleAction";
import { cn } from "@/lib/utils";
import { DataInspectorPanel } from "@/ui/layout/DataInspectorPanel";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { useSelectionSnapshot } from "./useSelectionSnapshot";

interface SelectPanelProps {
  app: Molvis | null;
}

interface SelectionItem {
  id: string;
  title: string;
  subtitle: string;
  atomCount: number;
  enabled: boolean;
}

const EXPRESSION_COPY = {
  running: "Evaluating the selection expression…",
  success: "Expression selection added",
  error: "Could not evaluate the selection expression",
};

const REORDER_COPY = {
  running: "Reordering selections…",
  success: "Selections reordered",
  error: "Could not reorder selections",
};

function producerLabel(
  mod: Modifier,
  atomCount: number,
): { title: string; subtitle: string } {
  const title =
    (mod as { selectionName?: string }).selectionName || mod.name || mod.id;
  if (atomCount > 0) {
    return { title, subtitle: `${atomCount} atoms` };
  }
  if (mod instanceof ExpressionSelectionModifier) {
    return {
      title,
      subtitle: mod.expression?.trim() || "empty expression",
    };
  }
  const summary = (mod as { selectionSummary?: string }).selectionSummary;
  if (summary && summary !== "empty") {
    return { title, subtitle: summary };
  }
  return { title, subtitle: "empty" };
}

/** Pipeline-style sortable row: hover grip · checkbox · title/subtitle. */
function SortableSelectionRow({
  item,
  selected,
  onSelect,
  onToggle,
}: {
  item: SelectionItem;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex min-h-control-compact min-w-0 select-none items-center px-2 py-1.5 transition-colors duration-(--motion-fast) ease-standard",
        selected ? "bg-accent/14" : "bg-background hover:bg-interactive",
        isDragging && "opacity-60",
      )}
    >
      {selected && (
        <span className="pointer-events-none absolute inset-y-0 left-0 z-1 w-0.5 bg-accent" />
      )}

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

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="h-5 w-4 shrink-0" aria-hidden />
        <div
          className="flex shrink-0 items-center justify-center"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            aria-label={`${item.title} enabled`}
            checked={item.enabled}
            onCheckedChange={() => onToggle()}
            onClick={(event) => event.stopPropagation()}
          />
        </div>

        <button
          type="button"
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          aria-current={selected ? "true" : undefined}
        >
          <span
            className={cn(
              "block min-w-0 truncate text-xs",
              selected && "font-medium",
              item.enabled
                ? "text-foreground"
                : "text-subtle-foreground line-through decoration-1",
            )}
            title={item.title}
          >
            {item.title}
          </span>
          <span
            className={cn(
              "mt-0.5 block truncate text-micro leading-none",
              item.enabled
                ? "text-muted-foreground"
                : "text-subtle-foreground/70",
            )}
            title={item.subtitle}
          >
            {item.subtitle}
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Select mode right panel: Fence / Expression tools + pipeline-style
 * multi-region list (drag reorder, enable checkbox, active row = highlight).
 */
export const SelectPanel: React.FC<SelectPanelProps> = ({ app }) => {
  const { run, running } = usePipelineOperation();
  const [expression, setExpression] = useState("");
  const [expressionOpen, setExpressionOpen] = useState(false);
  const [fenceActive, setFenceActive] = useState(false);
  const [selectionItems, setSelectionItems] = useState<SelectionItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const snapshot = useSelectionSnapshot(app);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    if (!app) return;
    const unsub = app.events.on("fence-select-change", (active: boolean) =>
      setFenceActive(active),
    );
    return unsub;
  }, [app]);

  const refreshSelectionItems = useCallback(() => {
    if (!app) {
      setSelectionItems([]);
      return;
    }
    const selSet = app.selectionSet;
    const active = app.activeSelectionId;
    const liveCount = app.world.selectionManager.getSelectedAtomIds().size;
    const items: SelectionItem[] = [];
    for (const mod of app.modifierPipeline.modifiers()) {
      if (!isSelectionProducer(mod)) continue;
      const mask = selSet.get(mod.id);
      let atomCount = mask?.count() ?? 0;
      const src = (mod as { selectionSource?: unknown }).selectionSource;
      if (Array.isArray(src) && src.length > atomCount) {
        atomCount = src.length;
      }
      if (mod.id === active && liveCount > atomCount) {
        atomCount = liveCount;
      }
      const { title, subtitle } = producerLabel(mod, atomCount);
      items.push({
        id: mod.id,
        title,
        subtitle,
        atomCount,
        enabled: mod.enabled,
      });
    }
    setSelectionItems(items);
    setActiveId(active);
  }, [app]);

  useEffect(() => {
    if (!app) return;
    setActiveId(app.activeSelectionId);
    const unsubActive = app.events.on("active-selection-change", ({ id }) => {
      setActiveId(id);
      refreshSelectionItems();
    });
    const unsubLive = app.world.selectionManager.on(
      "selection-change",
      refreshSelectionItems,
    );
    return () => {
      unsubActive();
      unsubLive();
    };
  }, [app, refreshSelectionItems]);

  useEffect(() => {
    if (!app) return;
    refreshSelectionItems();
    const p = app.modifierPipeline;
    p.on("computed", refreshSelectionItems);
    p.on("entry-added", refreshSelectionItems);
    p.on("entry-removed", refreshSelectionItems);
    p.on("entry-reordered", refreshSelectionItems);
    return () => {
      p.off("computed", refreshSelectionItems);
      p.off("entry-added", refreshSelectionItems);
      p.off("entry-removed", refreshSelectionItems);
      p.off("entry-reordered", refreshSelectionItems);
    };
  }, [app, refreshSelectionItems]);

  const handleActivate = useCallback(
    (id: string) => {
      app?.activateSelection(id);
    },
    [app],
  );

  const handleToggle = useCallback(
    (id: string) => {
      if (!app) return;
      const entry = app.modifierPipeline.getEntries().find((e) => e.id === id);
      if (!entry) return;
      void app.setEntryEnabled(entry, !entry.enabled);
    },
    [app],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!app || running || !over || active.id === over.id) return;

      const oldIndex = selectionItems.findIndex((i) => i.id === active.id);
      const newIndex = selectionItems.findIndex((i) => i.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      // Map producer-list index → full pipeline entry index of the drop target.
      const entries = app.modifierPipeline.getEntries();
      const overFullIndex = entries.findIndex((e) => e.id === over.id);
      if (overFullIndex < 0) return;

      setSelectionItems((current) => arrayMove(current, oldIndex, newIndex));
      app.modifierPipeline.reorderEntry(String(active.id), overFullIndex);
      void run(() => app.applyPipeline({ fullRebuild: true }), REORDER_COPY);
    },
    [app, running, selectionItems, run],
  );

  const handleExpressionSelect = useCallback(() => {
    if (!app || !expression.trim()) return;
    const modifier = new ExpressionSelectionModifier(
      `expr-${Date.now().toString(36)}`,
      expression.trim(),
    );
    void run(async () => {
      if (
        !app.modifierPipeline
          .modifiers()
          .some((item) => item.id === modifier.id)
      ) {
        app.modifierPipeline.addModifier(modifier);
      }
      app.activateSelection(modifier.id);
      await app.applyPipeline({ fullRebuild: true });
      setExpression("");
      setExpressionOpen(false);
    }, EXPRESSION_COPY);
  }, [app, expression, run]);

  const toggleFence = useCallback(() => {
    if (!app) return;
    if (fenceActive) app.exitFenceSelect();
    else app.enterFenceSelect();
  }, [app, fenceActive]);

  const selectedAtomIdsSet = useMemo(
    () => new Set(snapshot.atomIds),
    [snapshot.atomIds],
  );

  const hasSelection = snapshot.atomCount > 0 || snapshot.bondCount > 0;
  const canApplyExpression = expression.trim().length > 0;
  const itemIds = useMemo(
    () => selectionItems.map((i) => i.id),
    [selectionItems],
  );

  return (
    <fieldset
      disabled={!app || running}
      aria-busy={running}
      aria-label="Select tools"
      className="m-0 flex h-full min-w-0 flex-col border-0 p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 overflow-y-auto">
          <SidebarSection title="Tools" defaultOpen>
            <div
              className="flex flex-wrap items-center gap-1"
              role="toolbar"
              aria-label="Selection tools"
            >
              <ViewerToggleAction
                selected={fenceActive}
                className="min-w-0 justify-start gap-1.5"
                onClick={toggleFence}
                title={fenceActive ? "Cancel fence" : "Fence select on canvas"}
                aria-label={
                  fenceActive ? "Cancel fence" : "Fence select on canvas"
                }
              >
                <Lasso />
                <span className="truncate">Fence</span>
              </ViewerToggleAction>
              <ViewerToggleAction
                selected={expressionOpen}
                className="min-w-0 justify-start gap-1.5"
                onClick={() => setExpressionOpen((v) => !v)}
                title="Expression selection"
                aria-label="Expression selection"
              >
                <Code2 />
                <span className="truncate">Expression</span>
              </ViewerToggleAction>
            </div>
            {expressionOpen && (
              <div className="mt-1.5 flex items-center gap-1">
                <Input
                  id="select-expression"
                  aria-label="Selection expression"
                  className="h-control-compact min-w-0 flex-1 font-mono text-xs"
                  placeholder="element == 'C'"
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleExpressionSelect();
                  }}
                />
                <ViewerIconAction
                  icon={<Check />}
                  label="Apply expression"
                  className="shrink-0"
                  disabled={!canApplyExpression}
                  onClick={handleExpressionSelect}
                />
              </div>
            )}
          </SidebarSection>

          <SidebarSection title="Selections" defaultOpen>
            {selectionItems.length === 0 ? (
              <EmptyState density="compact" title="No selections" />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={itemIds}
                  strategy={verticalListSortingStrategy}
                >
                  <ul
                    className="m-0 list-none overflow-hidden rounded-control border border-border/50 p-0"
                    aria-label="Selection regions"
                  >
                    {selectionItems.map((item) => (
                      <li key={item.id} className="m-0 p-0">
                        <SortableSelectionRow
                          item={item}
                          selected={item.id === activeId}
                          onSelect={() => handleActivate(item.id)}
                          onToggle={() => handleToggle(item.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
            <div className="flex items-center justify-end gap-1.5 pt-2">
              <button
                type="button"
                className="flex h-control-compact w-control-compact shrink-0 items-center justify-center rounded-control border border-dashed border-border bg-panel text-muted-foreground transition-colors hover:bg-interactive hover:text-foreground"
                title="New selection"
                aria-label="New selection"
                onClick={() => {
                  app?.createManualSelection();
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="flex h-control-compact w-control-compact shrink-0 items-center justify-center rounded-control border border-border bg-panel text-muted-foreground transition-colors hover:bg-interactive hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                title="Remove selection"
                aria-label="Remove selection"
                disabled={!activeId}
                onClick={() => {
                  app?.removeActiveSelection();
                }}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
            </div>
          </SidebarSection>
        </div>

        {selectionItems.length > 0 ? (
          <section
            aria-label="Selected atoms and bonds"
            className="flex min-h-0 flex-1 flex-col border-t border-border/70"
          >
            {hasSelection ? (
              <DataInspectorPanel
                app={app}
                filterAtomIds={selectedAtomIdsSet}
                filterRevision={snapshot.revision}
                compact
              />
            ) : (
              <EmptyState density="compact" title="Empty region" />
            )}
          </section>
        ) : null}
      </div>
    </fieldset>
  );
};
