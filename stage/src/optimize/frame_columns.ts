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
 * Copy bond topology off a Frame without freeing the `get` borrow`.
 *
 * A bond endpoint that is **null** is refused, not read as atom 0: the dense
 * column buffer holds a `0` in a null cell, and `toRowIndex(0n)` would turn it
 * into a bond to the first atom — a wrong bond rather than a missing one.
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
  const i = bonds.view("atomi");
  const j = bonds.view("atomj");
  const t = bonds.has("bond_type") ? bonds.view("bond_type") : undefined;
  const n = bonds.nRows;
  const validI = bonds.validity("atomi");
  const validJ = bonds.validity("atomj");
  const bondI = new Uint32Array(n);
  const bondJ = new Uint32Array(n);
  const bondType = new Uint32Array(n);
  for (let b = 0; b < n; b++) {
    if (validI?.[b] === 0) {
      throw new Error(`bond ${b} has a null atomi endpoint`);
    }
    if (validJ?.[b] === 0) {
      throw new Error(`bond ${b} has a null atomj endpoint`);
    }
    bondI[b] = toRowIndex(i[b]);
    bondJ[b] = toRowIndex(j[b]);
    bondType[b] = t ? toRowIndex(t[b]) : BOND_TYPE_SINGLE;
  }
  return { bondI, bondJ, bondType };
}
