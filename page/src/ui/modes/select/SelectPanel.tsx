import {
  ExpressionSelectionModifier,
  isSelectionProducer,
  type Molvis,
  SelectModifier,
} from "@molcrafts/molvis-stage";
import { Check, Lasso, Plus, Trash2, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { ViewerToggleAction } from "@/components/viewer/ViewerToggleAction";
import { DataInspectorPanel } from "@/ui/layout/DataInspectorPanel";
import { SidebarSection } from "@/ui/layout/SidebarSection";
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
 * Two selection paths live in Edit-style SidebarSections (not one mixed strip):
 * 1. Canvas — fence / live pick, push to pipeline, clear
 * 2. Expression — query string → named pipeline selection
 *
 * Chrome is glyph-only; wording lives in tooltips / aria-label.
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Canvas pick: fence + live selection → pipeline */}
        <SidebarSection title="Canvas" defaultOpen>
          <div
            className="flex items-center gap-1"
            role="toolbar"
            aria-label="Canvas selection"
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
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <ViewerIconAction
                icon={<Plus />}
                label="Add selection to pipeline"
                disabled={!hasSelection}
                onClick={handleAddToPipeline}
              />
              <ViewerIconAction
                icon={<X />}
                label="Clear selection"
                disabled={!hasSelection}
                onClick={handleClearSelection}
              />
            </div>
          </div>
        </SidebarSection>

        {/* Expression: query → named pipeline selection */}
        <SidebarSection title="Expression" defaultOpen>
          <div className="flex items-center gap-1">
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
        </SidebarSection>

        {/* Named selections produced by the pipeline */}
        {selectionItems.length > 0 && (
          <SidebarSection
            title="Named"
            badge={String(selectionItems.length)}
            defaultOpen
          >
            <ul className="max-h-28 divide-y divide-border/40 overflow-y-auto rounded-control border border-border/50">
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
          </SidebarSection>
        )}

        {/* Selection inspector — count summary belongs here, not above tools */}
        <section
          aria-label="Selected atoms and bonds"
          className="flex min-h-0 flex-1 flex-col border-t border-border/70"
        >
          <div
            className="flex h-control-compact shrink-0 items-center px-2"
            aria-live="polite"
          >
            <p className="text-micro tabular-nums text-muted-foreground">
              {formatCount(snapshot.atomCount, snapshot.bondCount)}
            </p>
          </div>
          {hasSelection ? (
            <DataInspectorPanel
              app={app}
              filterAtomIds={selectedAtomIdsSet}
              filterRevision={snapshot.revision}
              compact
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3">
              <EmptyState density="compact" title="No selection" />
            </div>
          )}
        </section>
      </div>
    </fieldset>
  );
};
