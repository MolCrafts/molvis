import { toRowIndex } from "@molcrafts/molvis-core";
import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { remapBondSubset } from "../utils/bond_order";
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

    if (!input.has("atoms")) return input;
    const atoms = input.get("atoms");

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
      if (dtype === DType.Float) {
        copyFilteredF32(atoms, newAtoms, col, indexMap, nrows, newCount);
      } else if (dtype === DType.String) {
        copyFilteredStr(atoms, newAtoms, col, indexMap, nrows);
      } else if (dtype === DType.Uint) {
        copyFilteredU32(atoms, newAtoms, col, indexMap, nrows, newCount);
      } else if (dtype === DType.Int) {
        copyFilteredI32(atoms, newAtoms, col, indexMap, nrows, newCount);
      }
    }

    // Filter bonds
    const bonds = input.has("bonds") ? input.get("bonds") : undefined;
    let newBonds: Block | undefined;

    if (bonds && bonds.nRows > 0) {
      const iCol = bonds.view("atomi") as BigUint64Array;
      const jCol = bonds.view("atomj") as BigUint64Array;

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

function copyFilteredF32(
  src: Block,
  dst: Block,
  name: string,
  indexMap: Int32Array,
  nrows: number,
  newCount: number,
): void {
  const col =
    src.has(name) && src.dtype(name) === DType.Float
      ? (src.view(name) as Float64Array)
      : undefined;
  if (!col) return;
  const out = new Float64Array(newCount);
  let ptr = 0;
  for (let i = 0; i < nrows; i++) {
    if (indexMap[i] !== -1) out[ptr++] = col[i];
  }
  dst.set(name, out);
}

function copyFilteredStr(
  src: Block,
  dst: Block,
  name: string,
  indexMap: Int32Array,
  nrows: number,
): void {
  const col =
    src.has(name) && src.dtype(name) === DType.String
      ? (src.copy(name) as string[])
      : undefined;
  if (!col) return;
  const out: string[] = [];
  for (let i = 0; i < nrows; i++) {
    if (indexMap[i] !== -1) out.push(col[i]);
  }
  dst.set(name, out);
}

function copyFilteredU32(
  src: Block,
  dst: Block,
  name: string,
  indexMap: Int32Array,
  nrows: number,
  newCount: number,
): void {
  const col =
    src.has(name) && src.dtype(name) === DType.Uint
      ? (src.view(name) as BigUint64Array)
      : undefined;
  if (!col) return;
  const out = new BigUint64Array(newCount);
  let ptr = 0;
  for (let i = 0; i < nrows; i++) {
    if (indexMap[i] !== -1) out[ptr++] = col[i];
  }
  dst.set(name, out);
}

function copyFilteredI32(
  src: Block,
  dst: Block,
  name: string,
  indexMap: Int32Array,
  nrows: number,
  newCount: number,
): void {
  const col =
    src.has(name) && src.dtype(name) === DType.Int
      ? (src.view(name) as Int32Array)
      : undefined;
  if (!col) return;
  const out = new Int32Array(newCount);
  let ptr = 0;
  for (let i = 0; i < nrows; i++) {
    if (indexMap[i] !== -1) out[ptr++] = col[i];
  }
  dst.set(name, out);
}
