import { toRowIndex } from "@molcrafts/molvis-core";
import type { Frame } from "@molcrafts/molvis-core/molrs";
import { BOND_TYPE_SINGLE } from "../utils/bond_order";

/**
 * Copy atom x/y/z/element off a Frame without taking ownership of the
 * `get` borrow. The Block is a view of the Frame — never free it.
 */
export function copyAtomColumns(frame: Frame): {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  elements: string[];
  n: number;
} {
  if (!frame.has("atoms")) throw new Error("Working frame lost atoms");
  const atoms = frame.get("atoms");
  const x = atoms.copy("x") as Float64Array;
  const y = atoms.copy("y") as Float64Array;
  const z = atoms.copy("z") as Float64Array;
  const elements = atoms.copy("element") as string[];
  if (!x || !y || !z) throw new Error("Atoms missing x/y/z");
  return {
    x: new Float64Array(x),
    y: new Float64Array(y),
    z: new Float64Array(z),
    elements: [...elements],
    n: atoms.nRows,
  };
}

/**
 * Copy bond topology off a Frame without freeing the `get` borrow.
 */
export function copyBondColumns(frame: Frame): {
  bondI: Uint32Array;
  bondJ: Uint32Array;
  bondType: Uint32Array;
} {
  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  if (!bonds || bonds.nRows === 0) {
    return {
      bondI: new Uint32Array(0),
      bondJ: new Uint32Array(0),
      bondType: new Uint32Array(0),
    };
  }
  const i = bonds.view("atomi") as BigUint64Array;
  const j = bonds.view("atomj") as BigUint64Array;
  const t =
    bonds.has("bond_type") && bonds.dtype("bond_type") === "uint"
      ? (bonds.view("bond_type") as BigUint64Array)
      : undefined;
  const n = bonds.nRows;
  const bondI = new Uint32Array(n);
  const bondJ = new Uint32Array(n);
  const bondType = new Uint32Array(n);
  for (let b = 0; b < n; b++) {
    bondI[b] = toRowIndex(i[b] ?? 0n);
    bondJ[b] = toRowIndex(j[b] ?? 0n);
    bondType[b] = t ? toRowIndex(t[b]) : BOND_TYPE_SINGLE;
  }
  return { bondI, bondJ, bondType };
}
