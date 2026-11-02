import { toRowIndex } from "@molcrafts/molvis-core";
import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { remapBondSubset } from "../utils/bond_order";
import {
  compactKept,
  DType,
  isNumericDtype,
  type NumericArray,
} from "../utils/dtype";

/**
 * Modifier that hides atoms based on the current pipeline selection.
 * Reads selection from context.currentSelection (set by a preceding SelectModifier).
 * This is topology-changing: it removes atoms and remaps bond indices.
 */
export class HideSelectionModifier extends BaseModifier {
  private _lastCount = 0;

  constructor(id = "hide-selection-default") {
    super(
      id,
      "Hide Selection",
      new Set([
        ModifierCapability.ConsumesSelection,
        ModifierCapability.TransformsData,
      ]),
    );
  }

  /** Atoms hidden by the last pipeline run (0 before the first run). */
  get hiddenCount(): number {
    return this._lastCount;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const selection = context.currentSelection;
    const hiddenIndices = new Set(selection.getIndices());
    this._lastCount = hiddenIndices.size;
    if (hiddenIndices.size === 0) return input;

    const atoms = input.has("atoms") ? input.get("atoms") : undefined;
    if (!atoms) return input;

    const nrows = atoms.nRows;
    // Check if we need to filter
    let needFilter = false;
    for (let i = 0; i < nrows; i++) {
      if (hiddenIndices.has(i)) {
        needFilter = true;
        break;
      }
    }
    if (!needFilter) return input;

    // -- Filter Atoms --
    // Mapping from old index to new index. -1 indicates hidden.
    const indexMap = new Int32Array(nrows);
    let newCount = 0;

    for (let i = 0; i < nrows; i++) {
      if (hiddenIndices.has(i)) {
        indexMap[i] = -1;
      } else {
        indexMap[i] = newCount++;
      }
    }

    if (newCount === 0) {
      return new Frame();
    }

    // Filter atoms — copy every column by dtype so derived columns (notably
    // the molrs `id` column) survive hiding, matching DeleteSelectedModifier.
    const newAtoms = new Block();
    for (const key of atoms.keys()) {
      const dtype = atoms.dtype(key);
      if (dtype === DType.String) {
        const src = atoms.copy(key) as string[] | undefined;
        if (src) {
          const dst: string[] = [];
          for (let i = 0; i < nrows; i++) {
            if (indexMap[i] !== -1) dst.push(src[i]);
          }
          newAtoms.set(key, dst);
        }
      } else if (isNumericDtype(dtype)) {
        newAtoms.set(
          key,
          compactKept(atoms.view(key) as NumericArray, indexMap, newCount),
        );
      }
    }

    // -- Filter Bonds --
    const bonds = input.has("bonds") ? input.get("bonds") : undefined;
    let newBonds: Block | undefined;

    if (bonds && bonds.nRows > 0) {
      const iCol = bonds.view("atomi");
      const jCol = bonds.view("atomj");

      if (iCol && jCol) {
        const bondCount = bonds.nRows;
        const validBonds: number[] = [];

        for (let b = 0; b < bondCount; b++) {
          const oldI = iCol[b];
          const oldJ = jCol[b];
          if (
            indexMap[toRowIndex(oldI)] !== -1 &&
            indexMap[toRowIndex(oldJ)] !== -1
          ) {
            validBonds.push(b);
          }
        }

        newBonds = remapBondSubset(bonds, validBonds, indexMap, Block);
      }
    }

    const result = new Frame();
    result.set("atoms", newAtoms);
    if (newBonds) result.set("bonds", newBonds);

    const box = input.box;
    if (box) result.box = box;

    return result;
  }

  validate(_input: Frame, _context: PipelineContext) {
    return { valid: true };
  }
}
