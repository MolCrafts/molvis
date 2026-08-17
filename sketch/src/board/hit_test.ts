import type { MoleculeGraph } from "../molecule_graph";

/**
 * What the pointer is over on the 2D board, right now.
 *
 * A hit is transient and singular — hover, the target a click would act on,
 * what a context menu is about. It is not a selection: the board's committed
 * multi-select lives in its `selectedAtoms` / `selectedBonds` sets, survives
 * pointer movement, and is what highlighting renders. A hit may *lead* to a
 * selection; it never is one.
 *
 * Named for its surface so it never collides with the 3D scene's
 * `SceneHit`, which describes the same idea over Babylon meshes.
 */
export type BoardHit =
  | { kind: "atom"; index: number }
  | { kind: "bond"; index: number }
  | { kind: "none" };

/**
 * Hit-test atoms (disk) and bonds (segment distance) in document space.
 */
export class HitTester {
  constructor(
    private readonly atomRadiusDoc: number,
    private readonly bondHalfWidthDoc: number,
  ) {}

  hit(graph: MoleculeGraph, x: number, y: number): BoardHit {
    const data = graph.getMoleculeData();
    let bestAtom = -1;
    let bestAtomDist = Infinity;
    for (let i = 0; i < data.atoms.length; i++) {
      const a = data.atoms[i];
      const dx = a.x - x;
      const dy = a.y - y;
      const d = Math.hypot(dx, dy);
      if (d <= this.atomRadiusDoc && d < bestAtomDist) {
        bestAtomDist = d;
        bestAtom = i;
      }
    }
    if (bestAtom >= 0) return { kind: "atom", index: bestAtom };

    let bestBond = -1;
    let bestBondDist = Infinity;
    for (let b = 0; b < data.bonds.length; b++) {
      const bond = data.bonds[b];
      const a1 = data.atoms[bond.i];
      const a2 = data.atoms[bond.j];
      if (!a1 || !a2) continue;
      const d = pointSegmentDistance(x, y, a1.x, a1.y, a2.x, a2.y);
      if (d <= this.bondHalfWidthDoc && d < bestBondDist) {
        bestBondDist = d;
        bestBond = b;
      }
    }
    if (bestBond >= 0) return { kind: "bond", index: bestBond };
    return { kind: "none" };
  }
}

function pointSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}
