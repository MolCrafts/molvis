import { Block, Frame } from "@molcrafts/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { DType } from "../utils/dtype";

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

    const atoms = input.getBlock("atoms");
    if (!atoms) return input;

    if (!atoms.dtype("element")) return input;
    const elements = atoms.copyColStr("element") as string[];

    const nrows = atoms.nrows();
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
      if (dtype === DType.F64) {
        copyFilteredF32(atoms, newAtoms, col, indexMap, nrows, newCount);
      } else if (dtype === DType.String) {
        copyFilteredStr(atoms, newAtoms, col, indexMap, nrows);
      } else if (dtype === DType.U32) {
        copyFilteredU32(atoms, newAtoms, col, indexMap, nrows, newCount);
      } else if (dtype === DType.I32) {
        copyFilteredI32(atoms, newAtoms, col, indexMap, nrows, newCount);
      }
    }

    // Filter bonds
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
          if (indexMap[iCol[b]] !== -1 && indexMap[jCol[b]] !== -1) {
            validBonds.push(b);
          }
        }

        if (validBonds.length > 0) {
          newBonds = new Block();
          const nb = validBonds.length;
          const newI = new Uint32Array(nb);
          const newJ = new Uint32Array(nb);

          for (let k = 0; k < nb; k++) {
            const orig = validBonds[k];
            newI[k] = indexMap[iCol[orig]];
            newJ[k] = indexMap[jCol[orig]];
          }

          newBonds.setColU32("atomi", newI);
          newBonds.setColU32("atomj", newJ);
          if (orderCol) {
            const newOrder = new Uint32Array(nb);
            for (let k = 0; k < nb; k++) {
              newOrder[k] = orderCol[validBonds[k]];
            }
            newBonds.setColU32("order", newOrder);
          }
        }
      }
    }

    const result = new Frame();
    result.insertBlock("atoms", newAtoms);
    if (newBonds) result.insertBlock("bonds", newBonds);

    // Preserve box
    const box = input.simbox;
    if (box) result.simbox = box;

    return result;
  }
}

function copyFilteredF32(
  src: Block,
  dst: Block,
  name: string,
  indexMap: Int32Array,
  nrows: number,
  newCount: number,
): void {
  const col = src.dtype(name) === DType.F64 ? src.viewColF(name) : undefined;
  if (!col) return;
  const out = new Float64Array(newCount);
  let ptr = 0;
  for (let i = 0; i < nrows; i++) {
    if (indexMap[i] !== -1) out[ptr++] = col[i];
  }
  dst.setColF(name, out);
}

function copyFilteredStr(
  src: Block,
  dst: Block,
  name: string,
  indexMap: Int32Array,
  nrows: number,
): void {
  const col =
    src.dtype(name) === DType.String ? src.copyColStr(name) : undefined;
  if (!col) return;
  const out: string[] = [];
  for (let i = 0; i < nrows; i++) {
    if (indexMap[i] !== -1) out.push(col[i]);
  }
  dst.setColStr(name, out);
}

function copyFilteredU32(
  src: Block,
  dst: Block,
  name: string,
  indexMap: Int32Array,
  nrows: number,
  newCount: number,
): void {
  const col = src.dtype(name) === DType.U32 ? src.viewColU32(name) : undefined;
  if (!col) return;
  const out = new Uint32Array(newCount);
  let ptr = 0;
  for (let i = 0; i < nrows; i++) {
    if (indexMap[i] !== -1) out[ptr++] = col[i];
  }
  dst.setColU32(name, out);
}

function copyFilteredI32(
  src: Block,
  dst: Block,
  name: string,
  indexMap: Int32Array,
  nrows: number,
  newCount: number,
): void {
  const col = src.dtype(name) === DType.I32 ? src.viewColI32(name) : undefined;
  if (!col) return;
  const out = new Int32Array(newCount);
  let ptr = 0;
  for (let i = 0; i < nrows; i++) {
    if (indexMap[i] !== -1) out[ptr++] = col[i];
  }
  dst.setColI32(name, out);
}
