import type { MoleculeGraph } from "../molecule_graph";

/** Default bond length in document units. */
export const DEFAULT_BOND_LENGTH = 1.0;

/** Vertex / merge snap (document units). */
export const SNAP_RADIUS = 0.42 * DEFAULT_BOND_LENGTH;

/**
 * Looser radius when finishing a bond drag — prefer connect over spawning junk.
 */
export const CONNECT_SNAP_RADIUS = 0.55 * DEFAULT_BOND_LENGTH;

/** Bond direction snap step (degrees). ChemDraw-like 30° grid. */
export const ANGLE_SNAP_DEG = 30;

/**
 * Nearest atom within radius, or null. Ties break by lower index.
 */
export function findAtom(
  graph: MoleculeGraph,
  x: number,
  y: number,
  radius: number = SNAP_RADIUS,
): number | null {
  const data = graph.getMoleculeData();
  let best: number | null = null;
  let bestD = radius;
  for (let i = 0; i < data.atoms.length; i++) {
    const a = data.atoms[i];
    const d = Math.hypot(a.x - x, a.y - y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Snap a direction vector to ANGLE_SNAP_DEG grid; returns unit vector.
 * Zero-length input → (1, 0).
 */
export function snapDirection(
  dx: number,
  dy: number,
  stepDeg: number = ANGLE_SNAP_DEG,
): { ux: number; uy: number } {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { ux: 1, uy: 0 };
  const ang = Math.atan2(dy, dx);
  const step = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(ang / step) * step;
  return { ux: Math.cos(snapped), uy: Math.sin(snapped) };
}

/**
 * Ideal new-atom position: from `from` toward pointer, fixed bond length + angle snap,
 * then optional merge onto an existing atom within CONNECT_SNAP_RADIUS.
 */
export function resolveBondTarget(
  graph: MoleculeGraph,
  fromIndex: number,
  pointerX: number,
  pointerY: number,
  bondLength: number = DEFAULT_BOND_LENGTH,
): { x: number; y: number; existingIndex: number | null } {
  const from = graph.getAtom(fromIndex);
  const { ux, uy } = snapDirection(pointerX - from.x, pointerY - from.y);
  const x = from.x + ux * bondLength;
  const y = from.y + uy * bondLength;
  const existing = findAtom(graph, x, y, CONNECT_SNAP_RADIUS);
  if (existing !== null && existing !== fromIndex) {
    return { x, y, existingIndex: existing };
  }
  // Also: if pointer itself is near an atom, connect there
  const atPointer = findAtom(graph, pointerX, pointerY, CONNECT_SNAP_RADIUS);
  if (atPointer !== null && atPointer !== fromIndex) {
    return {
      x: graph.getAtom(atPointer).x,
      y: graph.getAtom(atPointer).y,
      existingIndex: atPointer,
    };
  }
  return { x, y, existingIndex: null };
}
