import type { Frame } from "@molcrafts/molvis-core/molrs";
import { SpatialNeighborQuery } from "../algo/neighbor_list";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { SelectionMask } from "../pipeline/types";

export type ExpandSelectionMode = "cutoff" | "bonds" | "both";

/**
 * OVITO-style **Expand Selection**: grow the current selection by
 * 1-hop bond adjacency and/or cutoff neighbors (Å).
 *
 * Result = original selection ∪ expanded neighborhood. Declares
 * {@link ModifierCapability.ConsumesSelection} so the pipeline can
 * bind `selectionScopeId` to an upstream producer.
 */
export class ExpandSelectionModifier extends BaseModifier {
  static readonly NAME = "Expand Selection";

  private _mode: ExpandSelectionMode = "cutoff";
  private _cutoff = 3.0;

  constructor(id = "expand-selection-default") {
    super(
      id,
      ExpandSelectionModifier.NAME,
      new Set([
        ModifierCapability.ConsumesSelection,
        ModifierCapability.ProducesSelection,
      ]),
    );
  }

  get mode(): ExpandSelectionMode {
    return this._mode;
  }

  set mode(value: ExpandSelectionMode) {
    this._mode = value;
  }

  /** Neighbor cutoff in angstrom (Å). Used when mode is `cutoff` or `both`. */
  get cutoff(): number {
    return this._cutoff;
  }

  set cutoff(value: number) {
    this._cutoff = value;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._mode}:${this._cutoff}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const atoms = input.getBlock("atoms");
    if (!atoms) {
      context.currentSelection = SelectionMask.none(0);
      context.selectionSet.set(this.id, context.currentSelection);
      return input;
    }

    const n = atoms.nrows();
    const base =
      context.currentSelection.size === n
        ? context.currentSelection
        : SelectionMask.none(n);

    const selected = new Set(base.getIndices());
    if (selected.size === 0) {
      const empty = SelectionMask.none(n);
      context.currentSelection = empty;
      context.selectionSet.set(this.id, empty);
      return input;
    }

    const expanded = new Set(selected);

    if (this._mode === "bonds" || this._mode === "both") {
      expandByBonds(input, n, selected, expanded);
    }
    if (this._mode === "cutoff" || this._mode === "both") {
      expandByCutoff(input, selected, expanded, this._cutoff);
    }

    const mask = SelectionMask.fromIndices(n, [...expanded]);
    context.currentSelection = mask;
    context.selectionSet.set(this.id, mask);
    return input;
  }
}

function expandByBonds(
  frame: Frame,
  n: number,
  selected: ReadonlySet<number>,
  expanded: Set<number>,
): void {
  const bonds = frame.getBlock("bonds");
  if (!bonds || bonds.nrows() === 0) return;
  const iCol = bonds.viewColU32("atomi");
  const jCol = bonds.viewColU32("atomj");
  if (!iCol || !jCol) return;

  for (let k = 0; k < iCol.length; k++) {
    const i = iCol[k];
    const j = jCol[k];
    if (i >= n || j >= n) continue;
    if (selected.has(i)) expanded.add(j);
    if (selected.has(j)) expanded.add(i);
  }
}

function expandByCutoff(
  frame: Frame,
  selected: ReadonlySet<number>,
  expanded: Set<number>,
  cutoff: number,
): void {
  if (!(cutoff > 0)) return;
  const atoms = frame.getBlock("atoms");
  if (!atoms || atoms.nrows() === 0) return;
  // Need coordinates for LinkedCell.
  if (!atoms.dtype("x") || !atoms.dtype("y") || !atoms.dtype("z")) return;

  const nAtoms = atoms.nrows();
  const box = frame.box;
  const hasPeriodicBox = box != null;
  box?.free();
  const query = new SpatialNeighborQuery(cutoff, {
    atomCount: nAtoms,
    algorithmContext: { hasPeriodicBox },
  });
  let neighbors: ReturnType<SpatialNeighborQuery["build"]> | null = null;
  try {
    neighbors = query.build(frame);
    const qi = neighbors.queryPointIndices();
    const pj = neighbors.pointIndices();
    // Copy views — WASM memory may move after free.
    const iArr = new Uint32Array(qi);
    const jArr = new Uint32Array(pj);
    for (let p = 0; p < iArr.length; p++) {
      const i = iArr[p];
      const j = jArr[p];
      if (selected.has(i)) expanded.add(j);
      if (selected.has(j)) expanded.add(i);
    }
  } catch {
    // Missing coords / box / WASM — keep original selection only.
  } finally {
    neighbors?.free();
    query.free();
  }
}
