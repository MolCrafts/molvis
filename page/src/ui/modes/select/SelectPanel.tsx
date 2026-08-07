import {
  ExpressionSelectionModifier,
  isSelectionProducer,
  type Molvis,
  SelectModifier,
} from "@molcrafts/molvis-stage";
import { Lasso, Plus, Trash2, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { ViewerToggleAction } from "@/components/viewer/ViewerToggleAction";
import { cn } from "@/lib/utils";
import { DataInspectorPanel } from "@/ui/layout/DataInspectorPanel";
import { useSelectionSnapshot } from "./useSelectionSnapshot";

interface SelectPanelProps {
  app: Molvis | null;
}

interface SelectionItem {
  id: string;
  label: string;
  atomCount: number;
}

const DELETE_COPY = {
  running: "Removing the selection…",
  success: "Selection removed",
  error: "Could not remove the selection",
};

const EXPRESSION_COPY = {
  running: "Evaluating the selection expression…",
  success: "Expression selection added",
  error: "Could not evaluate the selection expression",
};

function formatCount(atoms: number, bonds: number): string {
  return `${atoms} atom${atoms === 1 ? "" : "s"} · ${bonds} bond${bonds === 1 ? "" : "s"}`;
}

/**
 * Right-inspector surface for Select mode.
 *
 * Layout (top → bottom, one concern each):
 * 1. Live selection summary (canvas pick is WYSIWYG — highlight = selected)
 * 2. Fence + push live selection to pipeline / clear
 * 3. Expression form
 * 4. Named pipeline selections (when any)
 * 5. Atom/bond table for the current selection (fills remaining height)
 */
export const SelectPanel: React.FC<SelectPanelProps> = ({ app }) => {
  const { run, running } = usePipelineOperation();
  const [expression, setExpression] = useState("");
  const [fenceActive, setFenceActive] = useState(false);
  const [selectionItems, setSelectionItems] = useState<SelectionItem[]>([]);
  const snapshot = useSelectionSnapshot(app);

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
    const items: SelectionItem[] = [];
    for (const mod of app.modifierPipeline.modifiers()) {
      if (!isSelectionProducer(mod)) continue;
      const mask = selSet.get(mod.id);
      const atomCount = mask?.count() ?? 0;
      let label: string;
      if (mod instanceof ExpressionSelectionModifier) {
        label = mod.selectionName || mod.expression || mod.name;
      } else if (mod instanceof SelectModifier) {
        label = mod.selectionSummary || mod.id;
      } else {
        label = mod.name;
      }
      items.push({ id: mod.id, label, atomCount });
    }
    setSelectionItems(items);
  }, [app]);

  useEffect(() => {
    if (!app) return;
    refreshSelectionItems();
    const p = app.modifierPipeline;
    p.on("computed", refreshSelectionItems);
    p.on("entry-added", refreshSelectionItems);
    p.on("entry-removed", refreshSelectionItems);
    return () => {
      p.off("computed", refreshSelectionItems);
      p.off("entry-added", refreshSelectionItems);
      p.off("entry-removed", refreshSelectionItems);
    };
  }, [app, refreshSelectionItems]);

  const handleDeleteSelection = useCallback(
    (id: string) => {
      if (!app) return;
      void run(async () => {
        if (
          app.modifierPipeline
            .modifiers()
            .some((modifier) => modifier.id === id)
        ) {
          app.modifierPipeline.removeEntry(id);
        }
        await app.applyPipeline({ fullRebuild: true });
      }, DELETE_COPY);
    },
    [app, run],
  );

  /** Push live selection into the pipeline as a named SelectModifier. */
  const handleAddToPipeline = useCallback(() => {
    void app?.confirmPendingSelection();
  }, [app]);

  const handleClearSelection = useCallback(() => {
    app?.clearPendingSelection();
  }, [app]);

  const handleExpressionSelect = useCallback(() => {
    if (!app || !expression.trim()) return;
    const modifier = new ExpressionSelectionModifier(
      `expr-sel-${Date.now()}`,
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
      await app.applyPipeline({ fullRebuild: true });
      setExpression("");
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

  return (
    <fieldset
      disabled={!app || running}
      aria-busy={running}
      aria-label="Select tools"
      className="m-0 flex min-h-full min-w-0 flex-col border-0 p-0"
    >
      {/* 1. Live summary — count only; mode name lives in the tab strip */}
      <div
        className="flex h-control-compact shrink-0 items-center border-b border-border/70 px-2"
        aria-live="polite"
      >
        <p className="text-micro tabular-nums text-muted-foreground">
          {formatCount(snapshot.atomCount, snapshot.bondCount)}
        </p>
      </div>

      {/* 2. Canvas pick — live selection (WYSIWYG) */}
      <section
        aria-label="Canvas pick"
        className="shrink-0 space-y-2 border-b border-border/70 px-2 py-2"
      >
        <div className="flex items-center gap-1">
          <ViewerToggleAction
            selected={fenceActive}
            className="min-w-0 flex-1 justify-start"
            onClick={toggleFence}
          >
            <Lasso />
            <span className="truncate">
              {fenceActive ? "Drawing fence…" : "Fence"}
            </span>
          </ViewerToggleAction>
        </div>

        {hasSelection ? (
          <div className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-micro tabular-nums text-muted-foreground">
              Selected · {formatCount(snapshot.atomCount, snapshot.bondCount)}
            </span>
            <ViewerAction
              className="shrink-0"
              disabled={!hasSelection}
              onClick={handleAddToPipeline}
              title="Push live selection into the modifier pipeline"
            >
              <Plus />
              Pipeline
            </ViewerAction>
            <ViewerIconAction
              icon={<X />}
              label="Clear selection"
              onClick={handleClearSelection}
            />
          </div>
        ) : (
          <p className="text-micro leading-snug text-subtle-foreground">
            Click atoms on the canvas — highlight is the selection.
          </p>
        )}
      </section>

      {/* 3. Expression */}
      <section
        aria-label="Expression selection"
        className="shrink-0 space-y-1.5 border-b border-border/70 px-2 py-2"
      >
        <label
          htmlFor="select-expression"
          className="text-micro font-medium text-muted-foreground"
        >
          Expression
        </label>
        <div className="flex gap-1">
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
          <ViewerAction
            className="shrink-0"
            disabled={!canApplyExpression}
            onClick={handleExpressionSelect}
          >
            Apply
          </ViewerAction>
        </div>
      </section>

      {/* 4. Named selections from the pipeline */}
      {selectionItems.length > 0 && (
        <section
          aria-label="Named selections"
          className="shrink-0 border-b border-border/70"
        >
          <div className="flex items-center justify-between gap-2 px-2 pt-2 pb-1">
            <span className="text-micro font-medium text-muted-foreground">
              Named
            </span>
            <span className="text-micro tabular-nums text-subtle-foreground">
              {selectionItems.length}
            </span>
          </div>
          <ul className="max-h-28 divide-y divide-border/40 overflow-y-auto">
            {selectionItems.map((item) => (
              <li
                key={item.id}
                className="group flex items-center gap-1 px-2 py-1 text-micro hover:bg-interactive"
              >
                <span className="min-w-0 flex-1 truncate" title={item.label}>
                  {item.label}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {item.atomCount}
                </span>
                <ViewerIconAction
                  icon={<Trash2 />}
                  label={`Remove ${item.label}`}
                  tooltipSide="left"
                  onClick={() => handleDeleteSelection(item.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 5. Selection table — primary body */}
      <section
        aria-label="Selected atoms and bonds"
        className="flex min-h-0 flex-1 flex-col"
      >
        {hasSelection ? (
          <DataInspectorPanel
            app={app}
            filterAtomIds={selectedAtomIdsSet}
            filterRevision={snapshot.revision}
            compact
          />
        ) : (
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col items-center justify-center px-3",
            )}
          >
            <EmptyState
              density="compact"
              title="Nothing selected"
              description="Use the canvas tools, fence, or an expression above."
            />
          </div>
        )}
      </section>
    </fieldset>
  );
};
