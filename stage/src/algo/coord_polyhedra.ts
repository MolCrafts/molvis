/**
 * Pure geometry for coordination polyhedra wireframes.
 * Neighbor edges: complete graph among neighbors of each center (OVITO-style
 * when neighbor counts are small).
 */

export interface PolyhedronEdge {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
}

/**
 * Build wireframe edges for coordination polyhedra.
 *
 * @param positions - interleaved xyz length 3n
 * @param centers - center atom indices
 * @param neighborLists - for each center index in `centers`, neighbor atom indices
 */
export function buildPolyhedronEdges(
  positions: Float64Array | Float32Array,
  centers: readonly number[],
  neighborLists: readonly (readonly number[])[],
): PolyhedronEdge[] {
  const edges: PolyhedronEdge[] = [];
  const seen = new Set<string>();
  const pushEdge = (i: number, j: number) => {
    if (i === j) return;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const key = `${a}-${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    const ia = a * 3;
    const ib = b * 3;
    edges.push({
      ax: positions[ia],
      ay: positions[ia + 1],
      az: positions[ia + 2],
      bx: positions[ib],
      by: positions[ib + 1],
      bz: positions[ib + 2],
    });
  };

  for (let c = 0; c < centers.length; c++) {
    const center = centers[c];
    const neigh = neighborLists[c];
    if (!neigh || neigh.length < 2) continue;
    // Center → neighbor spokes
    for (const j of neigh) pushEdge(center, j);
    // Neighbor–neighbor edges (complete graph)
    for (let a = 0; a < neigh.length; a++) {
      for (let b = a + 1; b < neigh.length; b++) {
        pushEdge(neigh[a], neigh[b]);
      }
    }
  }
  return edges;
}

/** Flatten edges for Babylon CreateLineSystem: array of Vector3-like triples. */
export function edgesToLinePoints(
  edges: readonly PolyhedronEdge[],
): Array<Array<{ x: number; y: number; z: number }>> {
  return edges.map((e) => [
    { x: e.ax, y: e.ay, z: e.az },
    { x: e.bx, y: e.by, z: e.bz },
  ]);
}
