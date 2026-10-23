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
 * Modifier that hides hydrogen atoms from the scene.
 * Filters atoms where element === "H" and remaps bond indices.
 */
export class HideHydrogensModifier extends BaseModifier {
  private _hideHydrogens = true;

  constructor(id = "hide-hydrogens-default") {
    super(id, "Hide Hydrogens", new Set([ModifierCapability.TransformsData]));
  }

  get hideHydrogens(): boolean {
    return this._hideHydrogens;
  }

  set hideHydrogens(value: boolean) {
    this._hideHydrogens = value;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._hideHydrogens}`;
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    if (!this._hideHydrogens) return input;

    const atoms = input.has("atoms") ? input.get("atoms") : undefined;
    if (!atoms) return input;

    const elements = atoms.copy("element") as string[];

    const nrows = atoms.nRows;
    const indexMap = new Int32Array(nrows);
    let newCount = 0;

    for (let i = 0; i < nrows; i++) {
      if (elements[i] === "H") {
        indexMap[i] = -1;
      } else {
        indexMap[i] = newCount++;
      }
    }

    // If no hydrogens found, pass through
    if (newCount === nrows) return input;
    if (newCount === 0) return new Frame();

    // Filter atoms — iterate all columns dynamically
    const newAtoms = new Block();
    for (const col of atoms.keys()) {
      const dtype = atoms.dtype(col);
      if (isNumericDtype(dtype)) {
        newAtoms.set(
          col,
          compactKept(atoms.view(col) as NumericArray, indexMap, newCount),
        );
      } else if (dtype === DType.String) {
        copyFilteredStr(atoms, newAtoms, col, indexMap, nrows);
      }
    }

    // Filter bonds
    const bonds = input.has("bonds") ? input.get("bonds") : undefined;
    let newBonds: Block | undefined;

    if (bonds && bonds.nRows > 0) {
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

    // Preserve box
    const box = input.box;
    if (box) result.box = box;

    return result;
  }
}

function copyFilteredStr(
  src: Block,
  dst: Block,
  name: string,
  indexMap: Int32Array,
  nrows: number,
): void {
  const col =
    src.dtype(name) === DType.String ? (src.copy(name) as string[]) : undefined;
  if (!col) return;
  const out: string[] = [];
  for (let i = 0; i < nrows; i++) {
    if (indexMap[i] !== -1) out.push(col[i]);
  }
  dst.set(name, out);
}
