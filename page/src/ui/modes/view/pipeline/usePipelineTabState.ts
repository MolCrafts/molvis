import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import {
  DataSourceModifier,
  type Modifier,
  ModifierCapability,
  type Molvis,
  PipelineEvents,
  SelectModifier,
  isSelectionProducer,
  isTopologyChanging,
  nextModifierId,
} from "@molvis/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { getSelectedAtomIndices } from "../modifiers/selectionUtils";
import { getDescendants } from "./tree_utils";

const DEFAULT_PROPERTIES_HEIGHT = 250;
const MIN_PROPERTIES_HEIGHT = 100;
const MAX_PROPERTIES_RATIO = 0.8;

interface PendingDelete {
  modifier: Modifier;
  descendants: Modifier[];
}

interface PipelineState {
  modifiers: Modifier[];
  selectedId: string | null;
  selectedModifier: Modifier | undefined;
  propertiesHeight: number;
  isResizing: boolean;
  expandedIds: Set<string>;
  pendingDelete: PendingDelete | null;
  setSelectedId: (id: string | null) => void;
  startResizing: (event: React.MouseEvent) => void;
  handleAddModifier: (factory: () => Modifier) => void;
  handleRemoveModifier: (id: string) => void;
  handleToggleModifier: (modifier: Modifier) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleToggleExpand: (id: string) => void;
  handleConfirmDelete: () => void;
  handleCancelDelete: () => void;
  refreshModifiers: () => void;
}

export function usePipelineTabState(app: Molvis | null): PipelineState {
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [propertiesHeight, setPropertiesHeight] = useState(
    DEFAULT_PROPERTIES_HEIGHT,
  );
  const [isResizing, setIsResizing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );

  const refreshModifiers = useCallback(() => {
    if (!app) {
      setModifiers([]);
      return;
    }
    setModifiers([...app.modifierPipeline.getModifiers()]);
  }, [app]);

  useEffect(() => {
    if (!app) {
      return;
    }

    refreshModifiers();

    const pipeline = app.modifierPipeline;
    pipeline.on(PipelineEvents.MODIFIER_ADDED, refreshModifiers);
    pipeline.on(PipelineEvents.MODIFIER_REMOVED, refreshModifiers);
    pipeline.on(PipelineEvents.MODIFIER_REORDERED, refreshModifiers);
    pipeline.on(PipelineEvents.PIPELINE_CLEARED, refreshModifiers);

    return () => {
      pipeline.off(PipelineEvents.MODIFIER_ADDED, refreshModifiers);
      pipeline.off(PipelineEvents.MODIFIER_REMOVED, refreshModifiers);
      pipeline.off(PipelineEvents.MODIFIER_REORDERED, refreshModifiers);
      pipeline.off(PipelineEvents.PIPELINE_CLEARED, refreshModifiers);
    };
  }, [app, refreshModifiers]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    if (!modifiers.some((modifier) => modifier.id === selectedId)) {
      setSelectedId(null);
    }
  }, [modifiers, selectedId]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const nextHeight = window.innerHeight - event.clientY;
      const clampedHeight = Math.max(
        MIN_PROPERTIES_HEIGHT,
        Math.min(nextHeight, window.innerHeight * MAX_PROPERTIES_RATIO),
      );
      setPropertiesHeight(clampedHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const startResizing = useCallback((event: React.MouseEvent) => {
    setIsResizing(true);
    event.preventDefault();
  }, []);

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
      if (!app) {
        return;
      }

      const pipeline = app.modifierPipeline;
      const modifier = factory();

      const isSelSensitive = modifier.capabilities.has(
        ModifierCapability.ConsumesSelection,
      );
      const isSelProducer = isSelectionProducer(modifier);
      const isTopChange = isTopologyChanging(modifier);

      // For selection-sensitive, non-producer, non-topology modifiers:
      // attach to an existing SelectModifier if one exists, otherwise auto-create
      if (isSelSensitive && !isSelProducer && !isTopChange) {
        // Find the last selection-producing modifier in the pipeline
        const existingParent = [...pipeline.getModifiers()]
          .reverse()
          .find((m) => isSelectionProducer(m));

        if (existingParent) {
          // Reuse existing SelectModifier as parent
          modifier.parentId = existingParent.id;
          setExpandedIds((prev) => new Set([...prev, existingParent.id]));
        } else {
          // No select modifier exists — auto-create one from current selection
          const selectedAtomIndices = getSelectedAtomIndices(app);
          if (selectedAtomIndices.length > 0) {
            const selectMod = new SelectModifier(
              nextModifierId("select"),
              selectedAtomIndices,
              undefined,
              "replace",
              [],
            );
            selectMod.highlight = false;
            pipeline.addModifier(selectMod);
            modifier.parentId = selectMod.id;
            setExpandedIds((prev) => new Set([...prev, selectMod.id]));
          }
        }
      }

      pipeline.addModifier(modifier);
      setSelectedId(modifier.id);
      void app.applyPipeline({ fullRebuild: true });
    },
    [app],
  );

  const handleRemoveModifier = useCallback(
    (id: string) => {
      if (!app) {
        return;
      }
      const mod = modifiers.find((m) => m.id === id);
      if (!mod) {
        return;
      }

      const descendants = getDescendants(id, modifiers);
      if (descendants.length > 0) {
        setPendingDelete({ modifier: mod, descendants });
        return;
      }

      // DataSources need the lifecycle path (dispose WASM, re-derive
      // system trajectory). Plain modifiers go straight through pipeline.
      if (mod instanceof DataSourceModifier) {
        void app.removeDataSource(id);
      } else {
        app.modifierPipeline.removeModifier(id);
        void app.applyPipeline({ fullRebuild: true });
      }
      setSelectedId((prev) => (prev === id ? null : prev));
    },
    [app, modifiers],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!app || !pendingDelete) {
      return;
    }
    const target = pendingDelete.modifier;
    if (target instanceof DataSourceModifier) {
      void app.removeDataSource(target.id);
    } else {
      app.modifierPipeline.removeModifier(target.id);
      void app.applyPipeline({ fullRebuild: true });
    }
    setSelectedId(null);
    setPendingDelete(null);
  }, [app, pendingDelete]);

  const handleCancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  const handleToggleModifier = useCallback(
    (modifier: Modifier) => {
      modifier.enabled = !modifier.enabled;
      setModifiers((current) => [...current]);
      if (!app) {
        return;
      }
      void app.applyPipeline({ fullRebuild: true });
    },
    [app],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (!app || !over || active.id === over.id) {
        return;
      }

      const oldIndex = modifiers.findIndex(
        (modifier) => modifier.id === active.id,
      );
      const newIndex = modifiers.findIndex(
        (modifier) => modifier.id === over.id,
      );

      if (oldIndex < 0 || newIndex < 0) {
        return;
      }

      setModifiers((current) => arrayMove(current, oldIndex, newIndex));
      app.modifierPipeline.reorderModifier(active.id as string, newIndex);
      void app.applyPipeline({ fullRebuild: true });
    },
    [app, modifiers],
  );

  const selectedModifier = useMemo(
    () => modifiers.find((modifier) => modifier.id === selectedId),
    [modifiers, selectedId],
  );

  return {
    modifiers,
    selectedId,
    selectedModifier,
    propertiesHeight,
    isResizing,
    expandedIds,
    pendingDelete,
    setSelectedId,
    startResizing,
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
