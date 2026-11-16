/**
 * The one structure every surface algorithm returns.
 *
 * Marching cubes over a scalar field, quickhull over sampled spheres, and an
 * alpha complex over Delaunay tetrahedra have nothing in common upstream, but
 * they all end in triangles. Fixing that as the hand-off means a new algorithm
 * is one compute modifier and no renderer work at all.
 */

export interface SurfaceMesh {
  /** Flat xyz triples, length = 3 * nVertices. */
  positions: Float32Array;
  /** Triangle corner indices, length = 3 * nTriangles. */
  indices: Uint32Array;
  /** Per-vertex normals, same length as positions. */
  normals: Float32Array;
  /**
   * Optional per-vertex class, one per vertex: 0 paints in the draw style's
   * `color`, 1 in its `secondaryColor`. A pore surface sets 0 on the largest
   * connected pore and 1 on every other one.
   */
  classes?: Float32Array;
}

/**
 * Which lobe of a signed field a part belongs to.
 *
 * Most surfaces publish a single `primary` part. A signed field — a molecular
 * orbital, a spin difference — publishes both, and the draw step paints the
 * complement in a contrasting color so the two lobes read apart.
 */
export type SurfaceRole = "primary" | "complement";

export interface SurfacePart {
  mesh: SurfaceMesh;
  role: SurfaceRole;
}

export const EMPTY_SURFACE_MESH: SurfaceMesh = {
  positions: new Float32Array(0),
  indices: new Uint32Array(0),
  normals: new Float32Array(0),
};

export function isEmptySurface(mesh: SurfaceMesh): boolean {
  return mesh.indices.length === 0;
}

/** Convenience for the common case of one unsigned surface. */
export function primaryPart(mesh: SurfaceMesh): SurfacePart[] {
  return isEmptySurface(mesh) ? [] : [{ mesh, role: "primary" }];
}
