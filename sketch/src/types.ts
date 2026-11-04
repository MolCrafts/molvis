/**
 * 2D atom in document coordinates (Å-like units, not CSS pixels).
 */
export interface Atom2D {
  element: string;
  /** Document-space x (Å-like). */
  x: number;
  /** Document-space y (Å-like). */
  y: number;
  /** Formal charge (dimensionless). Default 0 when omitted. */
  charge?: number;
  /** Optional per-atom label color as a six-digit CSS hex value. */
  color?: string;
  /**
   * Implicit hydrogens drawn into the label (`OH`, `NH₂`). A non-negative
   * integer; omitted means none are shown. Not separate atoms.
   */
  hydrogens?: number;
  /**
   * Port (attachment point) descriptor on this atom, e.g. `<`, `>`, `$`, or
   * `$R` with a label. Drawn as a marker; a non-empty string when present.
   */
  port?: string;
}

/**
 * Bond between atom indices `i` and `j` in the parent atom list.
 */
export interface Bond2D {
  /** Atom index of the first endpoint. */
  i: number;
  /** Atom index of the second endpoint. */
  j: number;
  /** Bond order: 1, 2, or 3. */
  order: number;
  /** Stereochemistry for single bonds only. */
  stereo?: "none" | "up" | "down";
  /** Optional per-bond stroke color as a six-digit CSS hex value. */
  color?: string;
}

/**
 * Stable, implementation-independent sketch document contract.
 */
export interface MoleculeData {
  atoms: Atom2D[];
  bonds: Bond2D[];
}

/** One atom of a {@link SketchTopology}: 2D coordinates are optional. */
export type TopologyAtom = Omit<Atom2D, "x" | "y"> & { x?: number; y?: number };

/**
 * A sketch document whose coordinates may be missing. When any atom lacks a
 * finite `x`/`y`, `MoleculeLayout.place` lays out every atom from the graph.
 */
export interface SketchTopology {
  atoms: TopologyAtom[];
  bonds: Bond2D[];
}
