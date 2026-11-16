import type { MoleculeData } from "../types";

/**
 * Centre of the smallest ring that uses `excludedBond`, in the same space as
 * `atomPoints`. `null` when the bond is not in a ring. The double-bond offset
 * points at this centre so the inner line sits inside the ring.
 */
export function bondRingCentroid(
  data: MoleculeData,
  atomPoints: ReadonlyArray<{ x: number; y: number }>,
  adjacency: ReadonlyArray<ReadonlyArray<{ atom: number; bond: number }>>,
  excludedBond: number,
): { x: number; y: number } | null {
  const bond = data.bonds[excludedBond];
  if (!bond) return null;
  const parent = new Int32Array(data.atoms.length);
  parent.fill(-1);
  parent[bond.i] = bond.i;
  const queue = [bond.i];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const atom = queue[cursor];
    if (atom === bond.j) break;
    for (const edge of adjacency[atom] ?? []) {
      if (edge.bond === excludedBond || parent[edge.atom] !== -1) continue;
      parent[edge.atom] = atom;
      queue.push(edge.atom);
    }
  }
  if (parent[bond.j] === -1) return null;

  const cycleAtoms = [bond.j];
  let atom = bond.j;
  while (atom !== bond.i) {
    atom = parent[atom];
    cycleAtoms.push(atom);
  }
  let x = 0;
  let y = 0;
  for (const atomIndex of cycleAtoms) {
    const point = atomPoints[atomIndex];
    if (!point) return null;
    x += point.x;
    y += point.y;
  }
  return { x: x / cycleAtoms.length, y: y / cycleAtoms.length };
}
