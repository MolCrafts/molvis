import {
  type Frame,
  Topology as WasmTopology,
  type TopologyRingInfo as WasmTopologyRingInfo,
} from "@molcrafts/molvis-core/molrs";

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
 * Build a Topology graph from a frame.
 *
 * molrs `Topology.fromFrame` documents `i`/`j` bond columns; MolVis frames use
 * canonical `atomi`/`atomj`. Prefer fromFrame when it already has edges; else
 * construct explicitly from atomi/atomj (or i/j).
 */
function topologyFromFrame(frame: Frame): WasmTopology | null {
  const atoms = frame.getBlock("atoms");
  const bonds = frame.getBlock("bonds");
  if (!atoms || !bonds || bonds.nrows() === 0) return null;

  const nAtoms = atoms.nrows();
  let topo = WasmTopology.fromFrame(frame);
  if (topo.nBonds > 0) return topo;

  // fromFrame saw no edges — rebuild from MolVis bond columns.
  topo.free();
  topo = new WasmTopology(nAtoms);
  const atomi = bonds.viewColU32("atomi") ?? bonds.viewColU32("i") ?? undefined;
  const atomj = bonds.viewColU32("atomj") ?? bonds.viewColU32("j") ?? undefined;
  if (!atomi || !atomj) return topo;

  const nb = bonds.nrows();
  for (let b = 0; b < nb; b++) {
    const i = atomi[b];
    const j = atomj[b];
    if (i >= 0 && i < nAtoms && j >= 0 && j < nAtoms && i !== j) {
      topo.addBond(i, j);
    }
  }
  return topo;
}

/**
 * Detect rings in a molecular frame using the SSSR algorithm.
 *
 * @param frame - Frame with atoms and bonds blocks.
 * @returns Ring information, or null if no bonds are present.
 */
export function detectRings(frame: Frame): RingInfo | null {
  const atoms = frame.getBlock("atoms");
  const bonds = frame.getBlock("bonds");
  if (!atoms || !bonds || bonds.nrows() === 0) return null;

  const nAtoms = atoms.nrows();
  let topo: WasmTopology | null = null;
  let wasmRings: WasmTopologyRingInfo | null = null;

  try {
    topo = topologyFromFrame(frame);
    if (!topo) return null;

    wasmRings = topo.findRings();

    const numRings = wasmRings.numRings;
    if (numRings === 0) {
      return {
        numRings: 0,
        ringSizes: new Uint32Array(0),
        rings: [],
        atomRingMask: new Uint8Array(nAtoms),
      };
    }

    const ringSizes = new Uint32Array(wasmRings.ringSizes());
    const atomRingMask = new Uint8Array(wasmRings.atomRingMask(nAtoms));

    // Decode length-prefixed rings data
    const rawRings = wasmRings.rings();
    const rings: number[][] = [];
    let offset = 0;
    while (offset < rawRings.length) {
      const size = rawRings[offset++];
      const ring: number[] = [];
      for (let i = 0; i < size; i++) {
        ring.push(rawRings[offset++]);
      }
      rings.push(ring);
    }

    return { numRings, ringSizes, rings, atomRingMask };
  } finally {
    wasmRings?.free();
    topo?.free();
  }
}

/**
 * Check if a specific atom is in any ring.
 *
 * For repeated queries, prefer `detectRings()` and check `atomRingMask`.
 */
export function isAtomInRing(frame: Frame, atomIdx: number): boolean {
  let topo: WasmTopology | null = null;
  let wasmRings: WasmTopologyRingInfo | null = null;

  try {
    topo = topologyFromFrame(frame);
    if (!topo) return false;
    wasmRings = topo.findRings();
    return wasmRings.isAtomInRing(atomIdx);
  } finally {
    wasmRings?.free();
    topo?.free();
  }
}
