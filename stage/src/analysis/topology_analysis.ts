import { toRowIndex } from "@molcrafts/molvis-core";
import {
  type Frame,
  Topology as WasmTopology,
} from "@molcrafts/molvis-core/molrs";
import { isDomainUintDtype } from "../utils/dtype";

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
 * Graph of `frame` from `bonds.atomi` / `bonds.atomj`.
 *
 * molrs `Topology` is only `new Topology(n)` plus `addBond`. A frame door
 * on that class reads the wrong columns, so this is the only constructor.
 */
export function topologyFromBonds(frame: Frame): WasmTopology | null {
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  if (!atoms || atoms.nRows < 1) return null;
  const nAtoms = atoms.nRows;
  const topo = new WasmTopology(nAtoms);
  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  if (!bonds || bonds.nRows === 0) return topo;
  if (
    !bonds.has("atomi") ||
    !bonds.has("atomj") ||
    !isDomainUintDtype(bonds.dtype("atomi")) ||
    !isDomainUintDtype(bonds.dtype("atomj"))
  ) {
    return topo;
  }
  const atomi = bonds.view("atomi");
  const atomj = bonds.view("atomj");
  for (let b = 0; b < bonds.nRows; b++) {
    const i = toRowIndex(atomi[b] as number | bigint);
    const j = toRowIndex(atomj[b] as number | bigint);
    if (i < nAtoms && j < nAtoms && i !== j) topo.addBond(i, j);
  }
  return topo;
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
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  if (!atoms || atoms.nRows < 1) return null;

  let topo: WasmTopology | null = null;
  try {
    topo = topologyFromBonds(frame);
    if (!topo) return null;

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
    topo = topologyFromBonds(frame);
    if (!topo) return [];
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
    topo = topologyFromBonds(frame);
    if (!topo) return 0;
    return topo.degree(atomIdx);
  } finally {
    topo?.free();
  }
}
