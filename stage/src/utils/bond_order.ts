/**
 * molrs bond columns: `bond_type` + `bond_number` (u32).
 *
 * - bond_type: 0 unknown, 1 single, 2 double, 3 triple, 4 aromatic
 * - bond_number: localized Lewis integer (0 unknown; 1/2/3 for Kekulé)
 *
 * Kekulé phases are filled by molrs
 * {@link import("./kekule").withKekuleOrders} / `Perceive.findKekuleOrders`
 * at structure ingress — never reimplemented here. This module only maps
 * already-correct columns to stick counts and labels.
 */

import type { Block } from "@molcrafts/molvis-core/molrs";

export const BOND_TYPE_SINGLE = 1;
export const BOND_TYPE_DOUBLE = 2;
export const BOND_TYPE_TRIPLE = 3;
export const BOND_TYPE_AROMATIC = 4;

type BondColsBlock = {
  nrows(): number;
  dtype(key: string): string | undefined;
  viewColU32(key: string): Uint32Array | undefined;
};

/**
 * Human-readable bond label for hover / status (not a wire format).
 *
 * Examples: ``"single"``, ``"double"``, ``"triple"``, ``"aromatic"``,
 * ``"aromatic (Kekulé 2)"``.
 */
export function formatBondLabel(bondType: number, bondNumber: number): string {
  if (bondType === BOND_TYPE_AROMATIC) {
    return bondNumber > 0 ? `aromatic (Kekulé ${bondNumber})` : "aromatic";
  }
  if (bondType === BOND_TYPE_TRIPLE || bondNumber === 3) return "triple";
  if (bondType === BOND_TYPE_DOUBLE || bondNumber === 2) return "double";
  if (bondType === BOND_TYPE_SINGLE || bondNumber === 1) return "single";
  return "bond";
}

/**
 * Stick count for multi-bond rendering (1–3) from molrs columns.
 *
 * Aromatic with a filled Kekulé phase (`bond_type=4`, `bond_number` 1|2|3)
 * uses that number as the stick count. Aromatic without a phase
 * (`bond_number=0`) is one stick — call {@link withKekuleOrders} first at
 * ingress so rings are not left all-single.
 */
export function displayBondOrder(bondType: number, bondNumber: number): number {
  let sticks: number;
  if (bondType === BOND_TYPE_AROMATIC) {
    sticks = bondNumber > 0 ? bondNumber : 1;
  } else if (bondNumber > 0) {
    sticks = bondNumber;
  } else if (bondType >= BOND_TYPE_SINGLE && bondType <= BOND_TYPE_TRIPLE) {
    sticks = bondType;
  } else {
    sticks = 1;
  }
  // GPU multi-bond layout only has configs for 1..3 sticks.
  return sticks >= 3 ? 3 : sticks >= 2 ? 2 : 1;
}

/**
 * Per-row stick counts from molrs columns, or `null` when neither column is
 * present (every bond is single). Pure mapping — no topology / no Kekulé.
 */
export function resolveBondOrders(bonds: BondColsBlock): Float64Array | null {
  const n = bonds.nrows();
  if (n === 0) return null;

  const bondType = bonds.dtype("bond_type")
    ? bonds.viewColU32("bond_type")
    : undefined;
  const bondNumber = bonds.dtype("bond_number")
    ? bonds.viewColU32("bond_number")
    : undefined;
  if (!bondType && !bondNumber) return null;

  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = displayBondOrder(bondType?.[i] ?? 0, bondNumber?.[i] ?? 0);
  }
  return out;
}

/**
 * Edit-UI Lewis order (1|2|3) → molrs bond_type / bond_number.
 * Only used when the user picks a multi-bond from the toolbar — not for
 * frames that already carry real molrs columns.
 */
export function lewisOrderToBondCols(order: number): {
  type: number;
  number: number;
} {
  const n =
    Number.isFinite(order) && order >= 3
      ? 3
      : Number.isFinite(order) && order >= 2
        ? 2
        : 1;
  return { type: n, number: n };
}

/** Write atomi/atomj + bond_type + bond_number onto a new or existing block. */
export function setBondTopology(
  block: Block,
  atomi: Uint32Array,
  atomj: Uint32Array,
  bondType: Uint32Array,
  bondNumber: Uint32Array,
): void {
  block.setColU32("atomi", atomi);
  block.setColU32("atomj", atomj);
  block.setColU32("bond_type", bondType);
  block.setColU32("bond_number", bondNumber);
}

/**
 * Remap a subset of bonds onto a new atom index space, preserving
 * bond_type / bond_number.
 */
export function remapBondSubset(
  source: Block,
  keepRows: readonly number[],
  atomIndexMap: ArrayLike<number>,
  BlockCtor: new () => Block,
): Block | undefined {
  if (keepRows.length === 0) return undefined;

  const iCol = source.viewColU32("atomi");
  const jCol = source.viewColU32("atomj");
  if (!iCol || !jCol) return undefined;

  const nb = keepRows.length;
  const newI = new Uint32Array(nb);
  const newJ = new Uint32Array(nb);
  for (let k = 0; k < nb; k++) {
    const orig = keepRows[k];
    newI[k] = atomIndexMap[iCol[orig]];
    newJ[k] = atomIndexMap[jCol[orig]];
  }

  const bondType = source.dtype("bond_type")
    ? source.viewColU32("bond_type")
    : undefined;
  const bondNumber = source.dtype("bond_number")
    ? source.viewColU32("bond_number")
    : undefined;

  const types = new Uint32Array(nb);
  const numbers = new Uint32Array(nb);
  for (let k = 0; k < nb; k++) {
    const orig = keepRows[k];
    types[k] = bondType?.[orig] ?? BOND_TYPE_SINGLE;
    numbers[k] = bondNumber?.[orig] ?? types[k];
  }

  const out = new BlockCtor();
  setBondTopology(out, newI, newJ, types, numbers);
  return out;
}
