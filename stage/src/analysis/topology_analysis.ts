import {
  type Frame,
  Topology as WasmTopology,
} from "@molcrafts/molvis-core/molrs";

export interface TopologyAnalysisResult {
  /** Number of atoms. */
  nAtoms: number;
  /** Number of bonds. */
  nBonds: number;
  /** Number of unique angles. */
  nAngles: number;
  /** Number of unique proper dihedrals. */
  nDihedrals: number;
  /** Number of connected components. */
  nComponents: number;
  /** Angle triplets as flat array [i,j,k, ...] (Uint32Array). */
  angles: Uint32Array;
  /** Proper dihedral quartets as flat array [i,j,k,l, ...] (Uint32Array). */
  dihedrals: Uint32Array;
  /** Improper dihedral quartets as flat array [center,i,j,k, ...] (Uint32Array). */
  impropers: Uint32Array;
  /** Per-atom connected component labels (Int32Array). */
  componentLabels: Int32Array;
}

/**
 * Analyze the topology of a molecular frame.
 *
 * Builds a topology graph from the bonds block and computes angles,
 * dihedrals, impropers, and connected components. All computation
 * is delegated to WASM.
 *
 * @param frame - Frame with atoms and bonds blocks.
 * @returns Topology analysis result, or null if no atoms block.
 */
export function analyzeTopology(frame: Frame): TopologyAnalysisResult | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms || atoms.nrows() < 1) return null;

  let topo: WasmTopology | null = null;
  try {
    topo = WasmTopology.fromFrame(frame);

    return {
      nAtoms: topo.nAtoms,
      nBonds: topo.nBonds,
      nAngles: topo.nAngles,
      nDihedrals: topo.nDihedrals,
      nComponents: topo.nComponents,
      angles: new Uint32Array(topo.angles()),
      dihedrals: new Uint32Array(topo.dihedrals()),
      impropers: new Uint32Array(topo.impropers()),
      componentLabels: new Int32Array(topo.connectedComponents()),
    };
  } finally {
    topo?.free();
  }
}

/**
 * Get per-atom neighbor lists from topology.
 *
 * @param frame - Frame with atoms and bonds blocks.
 * @param atomIdx - Atom index to query.
 * @returns Array of neighbor atom indices.
 */
export function getTopologyNeighbors(frame: Frame, atomIdx: number): number[] {
  let topo: WasmTopology | null = null;
  try {
    topo = WasmTopology.fromFrame(frame);
    return Array.from(topo.neighbors(atomIdx));
  } finally {
    topo?.free();
  }
}

/**
 * Get degree of an atom in the topology graph.
 */
export function getTopologyDegree(frame: Frame, atomIdx: number): number {
  let topo: WasmTopology | null = null;
  try {
    topo = WasmTopology.fromFrame(frame);
    return topo.degree(atomIdx);
  } finally {
    topo?.free();
  }
}
