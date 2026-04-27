import { Block, Frame } from "@molcrafts/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { DType } from "../utils/dtype";

/**
 * Modifier that hides atoms based on the current pipeline selection.
 * Reads selection from context.currentSelection (set by a preceding SelectModifier).
 * This is topology-changing: it removes atoms and remaps bond indices.
 */
export class HideSelectionModifier extends BaseModifier {
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

  getCacheKey(): string {
    return `${super.getCacheKey()}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const selection = context.currentSelection;
    const hiddenIndices = new Set(selection.getIndices());
    if (hiddenIndices.size === 0) return input;

    const atoms = input.getBlock("atoms");
    if (!atoms) return input;

    const nrows = atoms.nrows();
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

    const newAtoms = new Block();

    // Helper to copy generic column
    const copyColF32 = (name: string) => {
      const src =
        atoms.dtype(name) === DType.F64 ? atoms.viewColF(name) : undefined;
      if (src) {
        const dst = new Float64Array(newCount);
        let ptr = 0;
        for (let i = 0; i < nrows; i++) {
          if (indexMap[i] !== -1) dst[ptr++] = src[i];
        }
        newAtoms.setColF(name, dst);
      }
    };

    const copyColStr = (name: string) => {
      const src =
        atoms.dtype(name) === DType.String ? atoms.copyColStr(name) : undefined;
      if (src) {
        const dst: string[] = [];
        for (let i = 0; i < nrows; i++) {
          if (indexMap[i] !== -1) dst.push(src[i]);
        }
        newAtoms.setColStr(name, dst);
      }
    };

    copyColF32("x");
    copyColF32("y");
    copyColF32("z");
    copyColStr("element");

    // Optional columns
    copyColF32("vx");
    copyColF32("vy");
    copyColF32("vz");
    copyColF32("occupancy");
    copyColF32("tempFactor");
    copyColF32("charge");

    // -- Filter Bonds --
    const bonds = input.getBlock("bonds");
    let newBonds: Block | undefined;

    if (bonds) {
      const iCol = bonds.viewColU32("atomi");
      const jCol = bonds.viewColU32("atomj");
      const orderCol =
        bonds.dtype("order") === DType.U32
          ? bonds.viewColU32("order")
          : undefined;

      if (iCol && jCol) {
        const bondCount = bonds.nrows();
        const validBonds: number[] = [];

        for (let b = 0; b < bondCount; b++) {
          const oldI = iCol[b];
          const oldJ = jCol[b];
          if (indexMap[oldI] !== -1 && indexMap[oldJ] !== -1) {
            validBonds.push(b);
          }
        }

        if (validBonds.length > 0) {
          newBonds = new Block();
          const newNb = validBonds.length;
          const newI = new Uint32Array(newNb);
          const newJ = new Uint32Array(newNb);
          const newOrder = new Uint32Array(newNb);

          for (let k = 0; k < newNb; k++) {
            const originalIdx = validBonds[k];
            newI[k] = indexMap[iCol[originalIdx]];
            newJ[k] = indexMap[jCol[originalIdx]];
            if (orderCol) newOrder[k] = orderCol[originalIdx];
            else newOrder[k] = 1;
          }

          newBonds.setColU32("atomi", newI);
          newBonds.setColU32("atomj", newJ);
          if (orderCol) newBonds.setColU32("order", newOrder);
        }
      }
    }

    const result = new Frame();
    result.insertBlock("atoms", newAtoms);
    if (newBonds) result.insertBlock("bonds", newBonds);

    const box = input.simbox;
    if (box) result.simbox = box;

    return result;
  }

  validate(_input: Frame, _context: PipelineContext) {
    return { valid: true };
  }
}
