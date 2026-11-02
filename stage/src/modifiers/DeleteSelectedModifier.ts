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
 * Modifier that removes atoms based on the current pipeline selection.
 * Reads selection from context.currentSelection (set by a preceding SelectModifier).
 * Performs actual removal (filtering) and remaps bond indices after atom removal.
 */
export class DeleteSelectedModifier extends BaseModifier {
  constructor(id = "delete-selected-default") {
    super(
      id,
      "Delete Selected",
      new Set([
        ModifierCapability.ConsumesSelection,
        ModifierCapability.TransformsData,
      ]),
    );
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const selection = context.currentSelection;
    const deletedIndices = new Set(selection.getIndices());
    if (deletedIndices.size === 0) return input;

    const atoms = input.has("atoms") ? input.get("atoms") : undefined;
    if (!atoms) return input;

    const nrows = atoms.nRows;
    let needFilter = false;
    for (let i = 0; i < nrows; i++) {
      if (deletedIndices.has(i)) {
        needFilter = true;
        break;
      }
    }
    if (!needFilter) return input;

    // Build index map: old -> new (-1 = deleted)
    const indexMap = new Int32Array(nrows);
    let newCount = 0;
    for (let i = 0; i < nrows; i++) {
      if (deletedIndices.has(i)) {
        indexMap[i] = -1;
      } else {
        indexMap[i] = newCount++;
      }
    }

    if (newCount === 0) return new Frame();

    // Filter atoms — handle all column dtypes
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

    // Filter bonds
    const bonds = input.has("bonds") ? input.get("bonds") : undefined;
    let newBonds: Block | undefined;

    if (bonds) {
      const iCol = bonds.view("atomi");
      const jCol = bonds.view("atomj");

      if (iCol && jCol) {
        const bondCount = bonds.nRows;
        const validBonds: number[] = [];

        for (let b = 0; b < bondCount; b++) {
          if (
            indexMap[toRowIndex(iCol[b])] !== -1 &&
            indexMap[toRowIndex(jCol[b])] !== -1
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
}
