import { describe, expect, it } from "@rstest/core";
import {
  captureStructuralSelectionSnapshot,
  type ReconcilableSelection,
  reconcileSelectionAfterStructuralUpdate,
} from "../src/selection_reconciler";

function makeSelection(opts: {
  atoms?: number[];
  hasExpression?: boolean;
  reapplyOk?: boolean;
}): ReconcilableSelection & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    getSelectedAtomIds: () => opts.atoms ?? [],
    hasExpressionSelectionContext: () => opts.hasExpression ?? false,
    reapplyLastExpression: () => {
      log.push("reapply");
      return opts.reapplyOk ?? false;
    },
    clearSelection: () => log.push("clear"),
    replaceAtomsByIds: (ids) => log.push(`replace:${[...ids].join(",")}`),
  };
}

describe("selection_reconciler", () => {
  it("snapshots current atom ids and expression flag", () => {
    const sel = makeSelection({ atoms: [3, 1, 2], hasExpression: true });
    const snap = captureStructuralSelectionSnapshot(sel);
    expect(snap.atomIds).toEqual([3, 1, 2]);
    expect(snap.hasExpressionSelection).toBe(true);
  });

  it("re-evaluates an expression selection on structural change", () => {
    const sel = makeSelection({ reapplyOk: true });
    reconcileSelectionAfterStructuralUpdate(sel, "full", {
      atomIds: [],
      hasExpressionSelection: true,
    });
    expect(sel.log).toEqual(["reapply"]);
  });

  it("clears when expression re-evaluation fails", () => {
    const sel = makeSelection({ reapplyOk: false });
    reconcileSelectionAfterStructuralUpdate(sel, "full", {
      atomIds: [5],
      hasExpressionSelection: true,
    });
    expect(sel.log).toEqual(["reapply", "clear"]);
  });

  it("preserves a manual atom selection across a bond-only change", () => {
    const sel = makeSelection({});
    reconcileSelectionAfterStructuralUpdate(sel, "bond", {
      atomIds: [7, 8],
      hasExpressionSelection: false,
    });
    expect(sel.log).toEqual(["replace:7,8"]);
  });

  it("clears a manual selection on a full (atom) topology change", () => {
    const sel = makeSelection({});
    reconcileSelectionAfterStructuralUpdate(sel, "full", {
      atomIds: [7, 8],
      hasExpressionSelection: false,
    });
    expect(sel.log).toEqual(["clear"]);
  });
});
