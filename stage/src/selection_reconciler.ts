import type { FrameUpdateKind } from "./system/frame_diff";

/**
 * Snapshot of structural selection state taken before a topology-changing frame
 * update, used to decide how to restore selection afterward.
 */
export interface StructuralSelectionSnapshot {
  atomIds: number[];
  hasExpressionSelection: boolean;
}

/**
 * Minimal selection surface the reconciler depends on. Declaring it here
 * (instead of importing the concrete `SelectionManager`) keeps the
 * reconciliation logic unit-testable without a BabylonJS scene — the review
 * flagged this logic as buried-and-untestable inside `MolvisApp`.
 */
export interface ReconcilableSelection {
  getSelectedAtomIds(): Iterable<number>;
  hasExpressionSelectionContext(): boolean;
  reapplyLastExpression(): boolean;
  clearSelection(): void;
  replaceAtomsByIds(ids: Iterable<number>): void;
}

/** Capture selection identity before a structural (topology) frame update. */
export function captureStructuralSelectionSnapshot(
  selection: ReconcilableSelection,
): StructuralSelectionSnapshot {
  return {
    atomIds: [...selection.getSelectedAtomIds()],
    hasExpressionSelection: selection.hasExpressionSelectionContext(),
  };
}

/**
 * Restore selection after a topology-changing frame update:
 * - Expression selections are re-evaluated against the new frame (cleared if
 *   re-evaluation fails).
 * - A manual atom selection survives a bond-only topology change (atom ids are
 *   still valid); other structural changes clear it (ids may no longer map).
 */
export function reconcileSelectionAfterStructuralUpdate(
  selection: ReconcilableSelection,
  updateKind: Exclude<FrameUpdateKind, "position">,
  snapshot: StructuralSelectionSnapshot,
): void {
  if (snapshot.hasExpressionSelection) {
    if (!selection.reapplyLastExpression()) {
      selection.clearSelection();
    }
    return;
  }

  if (updateKind === "bond" && snapshot.atomIds.length > 0) {
    selection.replaceAtomsByIds(snapshot.atomIds);
    return;
  }

  selection.clearSelection();
}
