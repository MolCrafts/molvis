import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import {
  DataSource,
  isSelectionProducer,
  type Modifier,
  ModifierCapability,
  type Molvis,
  nextModifierId,
  type PipelineEntry,
  PipelineEvents,
  SelectModifier,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";
import { usePointerDrag } from "@/hooks/usePointerDrag";
import {
  RESIZE_MAX_HEIGHT_RATIO,
  RESIZE_MIN_HEIGHT_PX,
} from "@/lib/viewer-layout";
import { modifierUsesLeftConfig } from "@/plugins";
import { useLeftShellOptional } from "@/ui/layout/LeftShellContext";
import { getSelectedAtomIndices } from "../modifiers/selectionUtils";
import { getDescendants } from "./tree_utils";

/** Default share of the pipeline column for the properties pane. */
const DEFAULT_PROPERTIES_RATIO = 0.38;
/** Floor when a modifier is selected (px). */
const MIN_PROPERTIES_HEIGHT = RESIZE_MIN_HEIGHT_PX;
/** Compact empty state when nothing is selected (px). */
const EMPTY_PROPERTIES_HEIGHT = 40;
/** Cap properties vs. list so the tree always keeps room. */
const MAX_PROPERTIES_RATIO = RESIZE_MAX_HEIGHT_RATIO;
/** List column keeps at least this much height (px). */
const MIN_LIST_HEIGHT = 120;

interface PendingDelete {
  modifier: PipelineEntry;
  descendants: PipelineEntry[];
}

interface PipelineState {
  entries: PipelineEntry[];
  selectedId: string | null;
  selectedModifier: PipelineEntry | undefined;
  /** Resolved px height for the properties pane (container-relative). */
  propertiesHeight: number;
  propertiesMaxHeight: number;
  isResizing: boolean;
  expandedIds: Set<string>;
  pendingDelete: PendingDelete | null;
  pipelineRunning: boolean;
  setSelectedId: (id: string | null) => void;
  /** Bind the pipeline column element so height adapts to the side rail. */
  setContainerEl: (el: HTMLElement | null) => void;
  /** Bind the properties pane so a drag can paint it without re-rendering. */
  setPropertiesEl: (el: HTMLElement | null) => void;
  startResizing: (event: React.PointerEvent) => void;
  resizePropertiesBy: (delta: number) => void;
  handleAddModifier: (factory: () => Modifier) => void;
  handleRemoveModifier: (id: string) => void;
  handleToggleModifier: (entry: PipelineEntry) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleToggleExpand: (id: string) => void;
  handleConfirmDelete: () => void;
  handleCancelDelete: () => void;
  refreshModifiers: () => void;
}

function clampPropertiesHeight(
  desired: number,
  containerH: number,
  hasSelection: boolean,
): number {
  if (containerH <= 0) {
    return hasSelection ? MIN_PROPERTIES_HEIGHT : EMPTY_PROPERTIES_HEIGHT;
  }
  if (!hasSelection) {
    return Math.min(EMPTY_PROPERTIES_HEIGHT, Math.max(0, containerH - 8));
  }
  const maxByRatio = Math.floor(containerH * MAX_PROPERTIES_RATIO);
  const maxByList = Math.max(
    MIN_PROPERTIES_HEIGHT,
    containerH - MIN_LIST_HEIGHT,
  );
  const maxH = Math.min(maxByRatio, maxByList);
  const minH = Math.min(MIN_PROPERTIES_HEIGHT, maxH);
  return Math.max(minH, Math.min(desired, maxH));
}

const ADD_COPY = {
  running: "Adding the pipeline step…",
  success: "Pipeline step added",
  error: "Could not add the pipeline step",
};

const REMOVE_COPY = {
  running: "Removing the pipeline step…",
  success: "Pipeline step removed",
  error: "Could not remove the pipeline step",
};

const UPDATE_COPY = {
  running: "Recomputing the pipeline…",
  success: "Pipeline updated",
  error: "Could not recompute the pipeline",
};

const REORDER_COPY = {
  running: "Reordering the pipeline…",
  success: "Pipeline reordered",
  error: "Could not reorder the pipeline",
};

export function usePipelineTabState(app: Molvis | null): PipelineState {
  const { run, running: pipelineRunning } = usePipelineOperation();
  const leftShell = useLeftShellOptional();
  const [entries, setEntries] = useState<PipelineEntry[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);

  const setSelectedId = useCallback(
    (id: string | null) => {
      setSelectedIdState(id);
      if (!id || !app || !leftShell) return;
      const mod = app.modifierPipeline.getEntries().find((m) => m.id === id);
      if (mod && modifierUsesLeftConfig(mod)) {
        leftShell.openLeftForModifier(id);
      }
    },
    [app, leftShell],
  );
  /** Fraction of the pipeline column; converted to px via container height. */
  const [propertiesRatio, setPropertiesRatio] = useState(
    DEFAULT_PROPERTIES_RATIO,
  );
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  /** Properties pane element, painted directly while a drag is in flight. */
  const propertiesElRef = useRef<HTMLElement | null>(null);
  /** Latest dragged height (px); committed to React state on pointer-up. */
  const dragHeightRef = useRef<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );

  useEffect(() => {
    if (!containerEl) {
      setContainerHeight(0);
      return;
    }
    const measure = () => {
      setContainerHeight(containerEl.getBoundingClientRect().height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl]);

  const refreshModifiers = useCallback(() => {
    if (!app) {
      setEntries([]);
      return;
    }
    setEntries([...app.modifierPipeline.getEntries()]);
  }, [app]);

  useEffect(() => {
    if (!app) {
      return;
    }

    refreshModifiers();

    const pipeline = app.modifierPipeline;
    pipeline.on(PipelineEvents.ENTRY_ADDED, refreshModifiers);
    pipeline.on(PipelineEvents.ENTRY_REMOVED, refreshModifiers);
    pipeline.on(PipelineEvents.ENTRY_REORDERED, refreshModifiers);
    pipeline.on(PipelineEvents.MODIFIER_SCOPE_CHANGED, refreshModifiers);
    pipeline.on(PipelineEvents.MODIFIER_OWNER_CHANGED, refreshModifiers);
    pipeline.on(PipelineEvents.PIPELINE_CLEARED, refreshModifiers);

    return () => {
      pipeline.off(PipelineEvents.ENTRY_ADDED, refreshModifiers);
      pipeline.off(PipelineEvents.ENTRY_REMOVED, refreshModifiers);
      pipeline.off(PipelineEvents.ENTRY_REORDERED, refreshModifiers);
      pipeline.off(PipelineEvents.MODIFIER_SCOPE_CHANGED, refreshModifiers);
      pipeline.off(PipelineEvents.MODIFIER_OWNER_CHANGED, refreshModifiers);
      pipeline.off(PipelineEvents.PIPELINE_CLEARED, refreshModifiers);
    };
  }, [app, refreshModifiers]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    if (!entries.some((modifier) => modifier.id === selectedId)) {
      setSelectedId(null);
    }
  }, [entries, selectedId, setSelectedId]);

  const { onPointerDown: startResizing, dragging: isResizing } = usePointerDrag(
    {
      onMove: (event) => {
        if (!containerEl) return;
        const rect = containerEl.getBoundingClientRect();
        if (rect.height <= 0) return;
        // Properties sit at the bottom of the column: height = bottom - cursor.
        const next = clampPropertiesHeight(
          rect.bottom - event.clientY,
          rect.height,
          true,
        );
        // Paint straight to the DOM instead of committing React state on every
        // pointer event. A state commit here re-renders PipelineTab, and with
        // it the whole unmemoized PipelineList (one SortableModifierItem +
        // dnd-kit useSortable per modifier) at pointer-event rate.
        dragHeightRef.current = next;
        const pane = propertiesElRef.current;
        if (pane) pane.style.height = `${next}px`;
      },
      onEnd: () => {
        const pending = dragHeightRef.current;
        dragHeightRef.current = null;
        if (pending === null || !containerEl) return;
        const rect = containerEl.getBoundingClientRect();
        if (rect.height > 0) setPropertiesRatio(pending / rect.height);
      },
    },
  );

  // A render triggered mid-drag (a pipeline event firing refreshModifiers,
  // say) would restore the stale `propertiesHeight` from JSX and make the
  // pane jump under the cursor. Re-apply the live drag height after every
  // render while a drag is in flight. No dep array on purpose.
  useEffect(() => {
    if (!isResizing) return;
    const pending = dragHeightRef.current;
    const pane = propertiesElRef.current;
    if (pending !== null && pane) {
      pane.style.height = `${pending}px`;
    }
  });

  const setPropertiesEl = useCallback((el: HTMLElement | null) => {
    propertiesElRef.current = el;
  }, []);

  const resizePropertiesBy = useCallback(
    (delta: number) => {
      if (containerHeight <= 0) return;
      setPropertiesRatio((ratio) => {
        const current = ratio * containerHeight;
        const next = clampPropertiesHeight(
          current + delta,
          containerHeight,
          true,
        );
        return next / containerHeight;
      });
    },
    [containerHeight],
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleAddModifier = useCallback(
    (factory: () => Modifier) => {
      if (!app || pipelineRunning) {
        return;
      }

      const pipeline = app.modifierPipeline;
      const modifier = factory();

      const consumesSelection = modifier.capabilities.has(
        ModifierCapability.ConsumesSelection,
      );

      // Auto-bind selection scope for every consumer (Hide/Delete/Edit types,
      // Invert/Expand, Assign Color, Vector field, …). Previously skipped
      // dual consume+produce and topology-changing steps, which broke OVITO-like
      // Expression Select → Invert / Expand → Hide chains.
      if (consumesSelection) {
        const existingScope = [...pipeline.modifiers()]
          .reverse()
          .find((m) => isSelectionProducer(m));

        if (existingScope) {
          modifier.selectionScopeId = existingScope.id;
          setExpandedIds((prev) => new Set([...prev, existingScope.id]));
        } else {
          const selectedAtomIndices = getSelectedAtomIndices(app);
          if (selectedAtomIndices.length > 0) {
            const selectMod = new SelectModifier(
              nextModifierId("select"),
              selectedAtomIndices,
              "replace",
              [],
            );
            selectMod.highlight = false;
            pipeline.addModifier(selectMod);
            modifier.selectionScopeId = selectMod.id;
            setExpandedIds((prev) => new Set([...prev, selectMod.id]));
          }
        }
      }

      pipeline.addModifier(modifier);
      setSelectedId(modifier.id);
      // setSelectedId already opens left config when applicable
      void run(() => app.applyPipeline({ fullRebuild: true }), ADD_COPY);
    },
    [app, pipelineRunning, run, setSelectedId],
  );

  const handleRemoveModifier = useCallback(
    (id: string) => {
      if (!app || pipelineRunning) {
        return;
      }
      const mod = entries.find((m) => m.id === id);
      if (!mod) {
        return;
      }

      const descendants = getDescendants(id, entries);
      if (descendants.length > 0) {
        setPendingDelete({ modifier: mod, descendants });
        return;
      }

      // DataSources need the lifecycle path (dispose WASM, re-derive
      // system trajectory). Plain entries go straight through pipeline.
      if (mod instanceof DataSource) {
        void run(() => app.removeDataSource(id), REMOVE_COPY);
      } else {
        app.modifierPipeline.removeEntry(id);
        void run(() => app.applyPipeline({ fullRebuild: true }), REMOVE_COPY);
      }
      setSelectedIdState((prev) => (prev === id ? null : prev));
    },
    [app, entries, pipelineRunning, run],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!app || !pendingDelete || pipelineRunning) {
      return;
    }
    const target = pendingDelete.modifier;
    if (target instanceof DataSource) {
      void run(() => app.removeDataSource(target.id), REMOVE_COPY);
    } else {
      app.modifierPipeline.removeEntry(target.id);
      void run(() => app.applyPipeline({ fullRebuild: true }), REMOVE_COPY);
    }
    setSelectedId(null);
    setPendingDelete(null);
  }, [app, pendingDelete, pipelineRunning, run, setSelectedId]);

  const handleCancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  const handleToggleModifier = useCallback(
    (modifier: PipelineEntry) => {
      if (pipelineRunning) return;
      const next = !modifier.enabled;
      if (!app) {
        modifier.enabled = next;
        setEntries((current) => [...current]);
        return;
      }
      // Optimistic UI: checkbox flips immediately. Visual layers only call
      // applyVisibility (instant); data entries still full-rebuild.
      void run(() => app.setEntryEnabled(modifier, next), UPDATE_COPY);
      setEntries((current) => [...current]);
    },
    [app, pipelineRunning, run],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (!app || pipelineRunning || !over || active.id === over.id) {
        return;
      }

      const oldIndex = entries.findIndex(
        (modifier) => modifier.id === active.id,
      );
      const newIndex = entries.findIndex((modifier) => modifier.id === over.id);

      if (oldIndex < 0 || newIndex < 0) {
        return;
      }

      const activeModifier = entries[oldIndex];
      const overModifier = entries[newIndex];
      const activeIsSource = activeModifier instanceof DataSource;
      const overIsSource = overModifier instanceof DataSource;
      if (activeIsSource !== overIsSource) return;

      setEntries((current) => arrayMove(current, oldIndex, newIndex));
      app.modifierPipeline.reorderEntry(active.id as string, newIndex);
      void run(() => app.applyPipeline({ fullRebuild: true }), REORDER_COPY);
    },
    [app, entries, pipelineRunning, run],
  );

  const selectedModifier = useMemo(
    () => entries.find((modifier) => modifier.id === selectedId),
    [entries, selectedId],
  );

  const hasSelection = selectedModifier !== undefined;
  const propertiesHeight = useMemo(() => {
    const desired = propertiesRatio * (containerHeight || 1);
    return clampPropertiesHeight(desired, containerHeight, hasSelection);
  }, [propertiesRatio, containerHeight, hasSelection]);

  const propertiesMaxHeight = useMemo(() => {
    if (containerHeight <= 0) return MIN_PROPERTIES_HEIGHT;
    return Math.max(
      MIN_PROPERTIES_HEIGHT,
      Math.min(
        Math.floor(containerHeight * MAX_PROPERTIES_RATIO),
        containerHeight - MIN_LIST_HEIGHT,
      ),
    );
  }, [containerHeight]);

  return {
    entries,
    selectedId,
    selectedModifier,
    propertiesHeight,
    propertiesMaxHeight,
    isResizing,
    expandedIds,
    pendingDelete,
    pipelineRunning,
    setSelectedId,
    setContainerEl,
    setPropertiesEl,
    startResizing,
    resizePropertiesBy,
    handleAddModifier,
    handleRemoveModifier,
    handleToggleModifier,
    handleDragEnd,
    handleToggleExpand,
    handleConfirmDelete,
    handleCancelDelete,
    refreshModifiers,
  };
}
