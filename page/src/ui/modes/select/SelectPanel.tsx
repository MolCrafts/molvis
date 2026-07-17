import {
  ExpressionSelectionModifier,
  isSelectionProducer,
  type Molvis,
  SelectModifier,
} from "@molvis/core";
import { Lasso, Plus, Trash2, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export const SelectPanel: React.FC<SelectPanelProps> = ({ app }) => {
  const [expression, setExpression] = useState("");
  const [fenceActive, setFenceActive] = useState(false);
  const [pendingAtomCount, setPendingAtomCount] = useState(0);
  const [pendingBondCount, setPendingBondCount] = useState(0);
  const [selectionItems, setSelectionItems] = useState<SelectionItem[]>([]);
  const snapshot = useSelectionSnapshot(app);

  // Fence state
  useEffect(() => {
    if (!app) return;
    const unsub = app.events.on("fence-select-change", (active: boolean) =>
      setFenceActive(active),
    );
    return unsub;
  }, [app]);

  // Pending counts — initial read + live event
  useEffect(() => {
    if (!app) {
      setPendingAtomCount(0);
      setPendingBondCount(0);
      return;
    }
    setPendingAtomCount(app.pendingAtomCount);
    setPendingBondCount(app.pendingBondCount);

    const unsub = app.events.on(
      "pending-selection-change",
      ({
        atomCount,
        bondCount,
      }: {
        atomKeys: string[];
        bondKeys: string[];
        atomCount: number;
        bondCount: number;
      }) => {
        setPendingAtomCount(atomCount);
        setPendingBondCount(bondCount);
      },
    );
    return unsub;
  }, [app]);

  // Selection items from pipeline
  const refreshSelectionItems = useCallback(() => {
    if (!app) {
      setSelectionItems([]);
      return;
    }
    const selSet = app.selectionSet;
    const items: SelectionItem[] = [];
    for (const mod of app.modifierPipeline.getModifiers()) {
      if (!isSelectionProducer(mod)) continue;
      const mask = selSet.get(mod.id);
      const atomCount = mask?.count() ?? 0;
      let label: string;
      if (mod instanceof ExpressionSelectionModifier) {
        label = mod.selectionName || mod.name;
      } else if (mod instanceof SelectModifier) {
        label = `${mod.id} · ${mod.selectionSummary}`;
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
    p.on("modifier-added", refreshSelectionItems);
    p.on("modifier-removed", refreshSelectionItems);
    return () => {
      p.off("computed", refreshSelectionItems);
      p.off("modifier-added", refreshSelectionItems);
      p.off("modifier-removed", refreshSelectionItems);
    };
  }, [app, refreshSelectionItems]);

  const handleDeleteSelection = useCallback(
    (id: string) => {
      if (!app) return;
      app.modifierPipeline.removeModifier(id);
      void app.applyPipeline({ fullRebuild: true });
    },
    [app],
  );

  const handleAddPending = useCallback(() => {
    app?.confirmPendingSelection();
  }, [app]);

  const handleClearPending = useCallback(() => {
    app?.clearPendingSelection();
  }, [app]);

  const handleExpressionSelect = useCallback(() => {
    if (!app || !expression.trim()) return;
    try {
      app.modifierPipeline.addModifier(
        new ExpressionSelectionModifier(
          `expr-sel-${Date.now()}`,
          expression.trim(),
        ),
      );
      void app.applyPipeline({ fullRebuild: true });
    } catch {
      // expression validated by ExpressionSelector.compile
    }
  }, [app, expression]);

  const selectedAtomIdsSet = useMemo(
    () => new Set(snapshot.atomIds),
    [snapshot.atomIds],
  );

  const hasPending = pendingAtomCount > 0 || pendingBondCount > 0;

  return (
    <div className="flex flex-col min-h-full">
      {/* Compact header */}
      <div className="h-7 px-2 border-b bg-muted/15 shrink-0 flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-wide uppercase">
          Select
        </span>
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {snapshot.atomCount}a / {snapshot.bondCount}b
        </span>
      </div>

      {/* Selection list — inline, no section header */}
      {selectionItems.length > 0 && (
        <div className="shrink-0 border-b">
          <div className="divide-y divide-border/30 max-h-28 overflow-y-auto">
            {selectionItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-1 py-0.5 px-2 text-[11px] hover:bg-accent/50 group"
              >
                <span className="flex-1 truncate">{item.label}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 mr-0.5">
                  {item.atomCount}a
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteSelection(item.id)}
                  aria-label="Remove selection"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending — compact */}
      <SidebarSection
        title={
          hasPending
            ? `Pending (${pendingAtomCount}a ${pendingBondCount}b)`
            : "Pending"
        }
        defaultOpen
        className="shrink-0"
      >
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="default"
            className="h-7 flex-1 text-xs"
            disabled={!hasPending}
            onClick={handleAddPending}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={!hasPending}
            onClick={handleClearPending}
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      </SidebarSection>

      {/* Fence */}
      <SidebarSection title="Fence" defaultOpen className="shrink-0">
        <Button
          size="sm"
          variant={fenceActive ? "secondary" : "outline"}
          className={`h-7 w-full px-2${fenceActive ? " ring-1 ring-ring" : ""}`}
          onClick={() => {
            if (fenceActive) app?.exitFenceSelect();
            else app?.enterFenceSelect();
          }}
          aria-pressed={fenceActive}
        >
          <Lasso className="h-3.5 w-3.5" />
        </Button>
      </SidebarSection>

      {/* Expression */}
      <SidebarSection title="Expression" defaultOpen className="shrink-0">
        <Input
          className="h-7 text-xs font-mono"
          placeholder="element == 'C'"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleExpressionSelect()}
        />
      </SidebarSection>

      {/* Data inspector — fills remaining space */}
      <div className="flex-1 min-h-0">
        <DataInspectorPanel
          app={app}
          filterAtomIds={selectedAtomIdsSet}
          filterRevision={snapshot.revision}
          compact
        />
      </div>
    </div>
  );
};
