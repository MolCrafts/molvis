/**
 * Topology Graph System.
 *
 * Provides a graph structure for managing atoms (vertices) and bonds (edges).
 * API is designed to be consistent with igraph for future WASM backend migration.
 */
export class Topology {
  // Map: vertexId -> Set of edgeIds connected to this vertex
  private adjacency: Map<number, Set<number>> = new Map();

  // Map: edgeId -> { source, target }
  private edges: Map<number, { source: number; target: number }> = new Map();

  /**
   * Add a vertex (atom) to the graph.
   */
  addAtom(id: number): void {
    if (!this.adjacency.has(id)) {
      this.adjacency.set(id, new Set());
    }
  }

  /**
   * Add an edge (bond) between two vertices.
   */
  addBond(id: number, source: number, target: number): void {
    // Register edge
    this.edges.set(id, { source, target });

    // Ensure vertices exist
    if (!this.adjacency.has(source)) {
      this.adjacency.set(source, new Set());
    }
    if (!this.adjacency.has(target)) {
      this.adjacency.set(target, new Set());
    }

    // Update adjacency
    this.adjacency.get(source)?.add(id);
    this.adjacency.get(target)?.add(id);
  }

  /**
   * Remove a vertex and all its connected edges.
   * Returns array of edge IDs that were removed.
   */
  removeAtom(id: number): number[] {
    const edgeIds = Array.from(this.adjacency.get(id) || []);

    // Remove all connected edges
    for (const edgeId of edgeIds) {
      this.removeBond(edgeId);
    }

    // Remove vertex
    this.adjacency.delete(id);

    return edgeIds;
  }

  /**
   * Remove an edge from the graph.
   */
  removeBond(id: number): void {
    const edge = this.edges.get(id);
    if (!edge) return;

    // Remove edge from adjacency lists
    const sourceEdges = this.adjacency.get(edge.source);
    const targetEdges = this.adjacency.get(edge.target);

    if (sourceEdges) {
      sourceEdges.delete(id);
    }
    if (targetEdges) {
      targetEdges.delete(id);
    }

    // Remove edge
    this.edges.delete(id);
  }

  /**
   * Get IDs of vertices connected to the given vertex.
   * igraph: neighbors(graph, v, mode = "all")
   */
  neighbors(id: number): number[] {
    const edgeIds = this.adjacency.get(id);
    if (!edgeIds) return [];

    const neighbors: number[] = [];
    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        // Add the OTHER vertex
        neighbors.push(edge.source === id ? edge.target : edge.source);
      }
    }
    return neighbors;
  }

  /**
   * Get IDs of edges incident to the given vertex.
   * igraph: incident(graph, v, mode = "all")
   */
  incident(id: number): number[] {
    return Array.from(this.adjacency.get(id) || []);
  }

  /**
   * Get bond IDs connected to an atom.
   * Alias for incident() with a chemistry-semantic name.
   */
  getBondsForAtom(atomId: number): Set<number> {
    return this.adjacency.get(atomId) ?? new Set();
  }

  /**
   * Get the source and target vertices of an edge.
   * igraph: ends(graph, es) -> we allow getting for single edge here for convenience.
   */
  endpoints(id: number): [number, number] | undefined {
    const edge = this.edges.get(id);
    return edge ? [edge.source, edge.target] : undefined;
  }

  /**
   * Get the degree of a vertex.
   * igraph: degree(graph, v)
   */
  degree(id: number): number {
    return this.adjacency.get(id)?.size || 0;
  }

  /**
   * Get total number of vertices.
   * igraph: vcount(graph)
   */
  vcount(): number {
    return this.adjacency.size;
  }

  /**
   * Get total number of edges.
   * igraph: ecount(graph)
   */
  ecount(): number {
    return this.edges.size;
  }

  /**
   * Clear all topology data.
   */
  clear(): void {
    this.adjacency.clear();
    this.edges.clear();
  }
}
