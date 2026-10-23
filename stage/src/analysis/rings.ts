import { toRowIndex } from "@molcrafts/molvis-core";
import { assignRings, type Frame } from "@molcrafts/molvis-core/molrs";
import { isDomainUintDtype } from "../utils/dtype";

export interface RingInfo {
  /** Total number of rings detected (SSSR). */
  numRings: number;
  /** Size of each ring (atom count), sorted ascending. */
  ringSizes: Uint32Array;
  /** All rings as arrays of atom indices. */
  rings: number[][];
  /** Per-atom boolean: true if atom is in any ring. */
  atomRingMask: Uint8Array;
}

/**
 * Detect rings in a molecular frame.
 *
 * molrs `assignRings` writes `is_in_ring` / `n_rings` and does not return the
 * cycles. The cycle list is the shortest ring through each flagged bond.
 *
 * @param frame - Frame with atoms and bonds blocks.
 * @returns Ring information, or null if no bonds are present.
 */
export function detectRings(frame: Frame): RingInfo | null {
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  if (!atoms || !bonds || bonds.nRows === 0) return null;

  const labeled = assignRings(frame);
  try {
    const labeledAtoms = labeled.has("atoms")
      ? labeled.get("atoms")
      : undefined;
    const labeledBonds = labeled.has("bonds")
      ? labeled.get("bonds")
      : undefined;
    if (!labeledAtoms || !labeledBonds) return null;
    const nAtoms = labeledAtoms.nRows;
    const atomRingMask = maskColumn(labeledAtoms, "is_in_ring", nAtoms);
    const rings = cyclesThroughRingBonds(labeledBonds, nAtoms);
    const ringSizes = new Uint32Array(rings.map((ring) => ring.length));
    return { numRings: rings.length, ringSizes, rings, atomRingMask };
  } finally {
    labeled.free();
  }
}

/**
 * Check if a specific atom is in any ring.
 *
 * For repeated queries, prefer `detectRings()` and check `atomRingMask`.
 */
export function isAtomInRing(frame: Frame, atomIdx: number): boolean {
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  if (!atoms || !bonds || bonds.nRows === 0) return false;
  if (atomIdx < 0 || atomIdx >= atoms.nRows) return false;
  const labeled = assignRings(frame);
  try {
    const labeledAtoms = labeled.has("atoms")
      ? labeled.get("atoms")
      : undefined;
    if (!labeledAtoms || atomIdx >= labeledAtoms.nRows) return false;
    if (!labeledAtoms.has("is_in_ring")) return false;
    return Number(labeledAtoms.view("is_in_ring")[atomIdx]) !== 0;
  } finally {
    labeled.free();
  }
}

function maskColumn(
  block: {
    has(key: string): boolean;
    view(key: string): ArrayLike<number | bigint>;
  },
  key: string,
  n: number,
): Uint8Array {
  const mask = new Uint8Array(n);
  if (!block.has(key)) return mask;
  const col = block.view(key);
  const len = Math.min(n, col.length);
  for (let i = 0; i < len; i++) mask[i] = Number(col[i]) !== 0 ? 1 : 0;
  return mask;
}

function cyclesThroughRingBonds(
  bonds: {
    nRows: number;
    has(key: string): boolean;
    dtype(key: string): string;
    view(key: string): ArrayLike<number | bigint>;
  },
  nAtoms: number,
): number[][] {
  if (
    !bonds.has("atomi") ||
    !bonds.has("atomj") ||
    !isDomainUintDtype(bonds.dtype("atomi")) ||
    !isDomainUintDtype(bonds.dtype("atomj"))
  ) {
    return [];
  }
  const atomi = bonds.view("atomi");
  const atomj = bonds.view("atomj");
  const inRing = bonds.has("is_in_ring") ? bonds.view("is_in_ring") : undefined;
  const adj: number[][] = Array.from({ length: nAtoms }, () => []);
  const edges: Array<[number, number]> = [];
  for (let b = 0; b < bonds.nRows; b++) {
    if (inRing && Number(inRing[b]) === 0) continue;
    const i = toRowIndex(atomi[b] as number | bigint);
    const j = toRowIndex(atomj[b] as number | bigint);
    if (i >= nAtoms || j >= nAtoms || i === j) continue;
    adj[i].push(j);
    adj[j].push(i);
    edges.push([i, j]);
  }
  const seen = new Set<string>();
  const rings: number[][] = [];
  for (const [i, j] of edges) {
    const cycle = shortestCycle(adj, i, j);
    if (!cycle) continue;
    const key = cycle
      .slice()
      .sort((a, b) => a - b)
      .join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    rings.push(cycle);
  }
  rings.sort((a, b) => a.length - b.length || a[0] - b[0]);
  return rings;
}

/** Shortest path from `start` to `end` that does not take the direct edge. */
function shortestCycle(
  adj: number[][],
  start: number,
  end: number,
): number[] | null {
  const prev = new Map<number, number>();
  const queue = [start];
  prev.set(start, -1);
  let head = 0;
  while (head < queue.length) {
    const u = queue[head];
    head += 1;
    for (const v of adj[u]) {
      if (u === start && v === end) continue;
      if (prev.has(v)) continue;
      prev.set(v, u);
      if (v === end) {
        const path = [end];
        let cur = end;
        while (cur !== start) {
          const parent = prev.get(cur);
          if (parent === undefined || parent < 0) break;
          cur = parent;
          path.push(cur);
        }
        path.reverse();
        return path;
      }
      queue.push(v);
    }
  }
  return null;
}
