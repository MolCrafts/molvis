import type { Frame } from "@molcrafts/molvis-core/molrs";
import { BOND_TYPE_SINGLE } from "../utils/bond_order";

/**
 * Copy atom x/y/z/element off a Frame without taking ownership of the
 * `getBlock` borrow. The Block is a view of the Frame — never free it.
 */
export function copyAtomColumns(frame: Frame): {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  elements: string[];
  n: number;
} {
  const atoms = frame.getBlock("atoms");
  if (!atoms) throw new Error("Working frame lost atoms");
  const x = atoms.copyColF("x");
  const y = atoms.copyColF("y");
  const z = atoms.copyColF("z");
  const elements =
    atoms.copyColStr("element") ??
    Array.from({ length: atoms.nrows() }, () => "C");
  if (!x || !y || !z) throw new Error("Atoms missing x/y/z");
  return {
    x: new Float64Array(x),
    y: new Float64Array(y),
    z: new Float64Array(z),
    elements: [...elements],
    n: atoms.nrows(),
  };
}

/**
 * Copy bond topology off a Frame without freeing the `getBlock` borrow.
 */
export function copyBondColumns(frame: Frame): {
  bondI: Uint32Array;
  bondJ: Uint32Array;
  bondType: Uint32Array;
} {
  const bonds = frame.getBlock("bonds");
  if (!bonds || bonds.nrows() === 0) {
    return {
      bondI: new Uint32Array(0),
      bondJ: new Uint32Array(0),
      bondType: new Uint32Array(0),
    };
  }
  const i =
    bonds.viewColU32("atomi") ?? bonds.viewColU32("i") ?? new Uint32Array(0);
  const j =
    bonds.viewColU32("atomj") ?? bonds.viewColU32("j") ?? new Uint32Array(0);
  const t = bonds.dtype("bond_type")
    ? (bonds.viewColU32("bond_type") ?? undefined)
    : undefined;
  const n = bonds.nrows();
  const bondI = new Uint32Array(n);
  const bondJ = new Uint32Array(n);
  const bondType = new Uint32Array(n);
  for (let b = 0; b < n; b++) {
    bondI[b] = i[b] ?? 0;
    bondJ[b] = j[b] ?? 0;
    bondType[b] = t?.[b] ?? BOND_TYPE_SINGLE;
  }
  return { bondI, bondJ, bondType };
}
