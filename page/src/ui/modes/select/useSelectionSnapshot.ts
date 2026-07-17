import type { Molvis, SelectionState } from "@molvis/core";
import { useEffect, useMemo, useState } from "react";

export interface SelectionSnapshot {
  selection: SelectionState;
  atomIds: number[];
  bondIds: number[];
  elements: string[];
  atomCount: number;
  bondCount: number;
  revision: number;
}

function cloneSelectionState(state: SelectionState): SelectionState {
  return {
    atoms: new Set(state.atoms),
    bonds: new Set(state.bonds),
    revision: state.revision,
  };
}

export function useSelectionSnapshot(app: Molvis | null): SelectionSnapshot {
  const [selection, setSelection] = useState<SelectionState>({
    atoms: new Set(),
    bonds: new Set(),
    revision: 0,
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!app) {
      setSelection({ atoms: new Set(), bonds: new Set(), revision: 0 });
      setRevision(0);
      return;
    }

    const manager = app.world.selectionManager;
    if (!manager) {
      return;
    }

    setSelection(cloneSelectionState(manager.getState()));
    setRevision((prev) => prev + 1);

    const unsub = manager.on("selection-change", (state) => {
      setSelection(cloneSelectionState(state));
      setRevision((prev) => prev + 1);
    });

    return unsub;
  }, [app]);

  const atomIds = useMemo(() => {
    if (!app) {
      return [];
    }

    return [...selection.atoms].sort((a, b) => a - b);
  }, [app, selection]);

  const bondIds = useMemo(() => {
    if (!app) {
      return [];
    }

    return [...selection.bonds].sort((a, b) => a - b);
  }, [app, selection]);

  const elements = useMemo(() => {
    if (!app || atomIds.length === 0) {
      return [];
    }

    const values = new Set<string>();
    for (const atomId of atomIds) {
      const element = app.world.sceneIndex.getAttribute(
        "atom",
        atomId,
        "element",
      );
      if (typeof element === "string" && element.length > 0) {
        values.add(element);
      }
    }

    return [...values].sort();
  }, [app, atomIds]);

  return {
    selection,
    atomIds,
    bondIds,
    elements,
    atomCount: selection.atoms.size,
    bondCount: selection.bonds.size,
    revision,
  };
}
