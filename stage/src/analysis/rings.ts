import {
  assignRings,
  type Frame,
  Topology,
} from "@molcrafts/molvis-core/molrs";

export interface RingInfo {
  /** Total number of rings detected (SSSR). */
  numRings: number;
  /** Per-atom flag: 1 if the atom is in any ring. */
  atomRingMask: Uint8Array;
}

/**
 * Detect rings in a molecular frame (SSSR, molrs `assignRings`).
 *
 * The SSSR has as many rings as the bond graph's cyclomatic number,
 * `nBonds - nAtoms + nComponents`, which molrs's `Topology` reports.
 *
 * @param frame - Frame with atoms and bonds blocks.
 * @returns Ring information, or null if no bonds are present.
 */
export function detectRings(frame: Frame): RingInfo | null {
  if (!frame.has("atoms") || !frame.has("bonds")) return null;
  if (frame.get("bonds").nRows === 0) return null;

  const ringed = assignRings(frame);
  const topo = Topology.fromFrame(frame);
  try {
    const inRing = ringed.get("atoms").copy("is_in_ring") as Int32Array;
    return {
      numRings: topo.nBonds - topo.nAtoms + topo.nComponents,
      atomRingMask: Uint8Array.from(inRing, (flag) => (flag ? 1 : 0)),
    };
  } finally {
    topo.free();
    ringed.free();
  }
}

/**
 * Check if a specific atom is in any ring.
 *
 * For repeated queries, prefer `detectRings()` and check `atomRingMask`.
 */
export function isAtomInRing(frame: Frame, atomIdx: number): boolean {
  return detectRings(frame)?.atomRingMask[atomIdx] === 1;
}
