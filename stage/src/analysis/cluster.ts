import { toRowIndex } from "@molcrafts/molvis-core";
import {
  Cluster,
  type Frame,
  type ClusterResult as WasmClusterResult,
} from "@molcrafts/molvis-core/molrs";
import { SpatialNeighborQuery } from "../algo/neighbor_list";
import { estimateRMax } from "./utils";

export type ConnectivityMode = "cutoff" | "bonds";

export interface ClusterParams {
  /** Connectivity: "cutoff" (distance) or "bonds" (topology subgraphs). Default "cutoff". */
  mode?: ConnectivityMode;
  /** Neighbor cutoff (cutoff mode only). Auto if omitted. */
  rMax?: number;
  /**
   * Minimum particles for a valid cluster (cutoff mode). Default 1 — a lone
   * atom is a cluster. Ignored in bonds mode (always 1).
   */
  minClusterSize?: number;
  /** Only cluster these atom indices; others get -1. */
  selectedIndices?: number[];
  /**
   * Sort cluster IDs by descending size. Default **false** (stable discovery
   * order). Table UIs sort by column header instead.
   */
  sortBySize?: boolean;
}

export interface ClusterResult {
  /** Per-atom cluster ID. -1 = not selected / filtered. */
  clusterIdx: Int32Array;
  /** Size of each cluster (length = numClusters). */
  clusterSizes: Uint32Array;
  numClusters: number;
  nParticles: number;
  mode: ConnectivityMode;
  rMax: number;
  minClusterSize: number;
}

/**
 * Cluster analysis on a frame.
 *
 * - **cutoff**: LinkedCell neighbor graph → BFS components (freud-style).
 * - **bonds**: molecular topology subgraphs from the bonds block (atomi/atomj);
 *   no distance parameter; every atom belongs to a component (isolates = size 1).
 */
export function computeClusters(
  frame: Frame,
  params: ClusterParams = {},
): ClusterResult | null {
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  if (!atoms || atoms.nRows < 1) return null;

  const nParticles = atoms.nRows;
  const mode = params.mode ?? "cutoff";
  const minClusterSize =
    mode === "bonds" ? 1 : Math.max(1, params.minClusterSize ?? 1);
  const sortBySize = params.sortBySize ?? false;

  if (mode === "bonds") {
    return computeClustersByBonds(
      frame,
      nParticles,
      sortBySize,
      params.selectedIndices,
    );
  }
  return computeClustersByCutoff(
    frame,
    nParticles,
    minClusterSize,
    sortBySize,
    params,
  );
}

// ---------------------------------------------------------------------------
// Cutoff-distance mode (WASM LinkedCell + Cluster)
// ---------------------------------------------------------------------------

function computeClustersByCutoff(
  frame: Frame,
  nParticles: number,
  minClusterSize: number,
  sortBySize: boolean,
  params: ClusterParams,
): ClusterResult | null {
  const rMax = params.rMax ?? estimateRMax(frame);
  if (rMax <= 0) return null;

  let query: SpatialNeighborQuery | null = null;
  let nlist: ReturnType<SpatialNeighborQuery["build"]> | null = null;
  let cluster: Cluster | null = null;
  let wasmResult: WasmClusterResult | null = null;

  try {
    query = new SpatialNeighborQuery(rMax);
    nlist = query.build(frame);
    cluster = new Cluster(minClusterSize);
    wasmResult = cluster.compute(frame, nlist);

    let clusterIdx = wasmResult.clusterIdx();
    let clusterSizes = wasmResult.clusterSizes();
    let numClusters = wasmResult.nClusters;

    if (params.selectedIndices) {
      ({ clusterIdx, clusterSizes, numClusters } = filterBySelection(
        clusterIdx,
        nParticles,
        params.selectedIndices,
        minClusterSize,
      ));
    }

    if (sortBySize) {
      ({ clusterIdx, clusterSizes, numClusters } = sortClusters(
        clusterIdx,
        clusterSizes,
        numClusters,
      ));
    }

    return {
      clusterIdx,
      clusterSizes,
      numClusters,
      nParticles,
      mode: "cutoff",
      rMax,
      minClusterSize,
    };
  } finally {
    wasmResult?.free();
    cluster?.free();
    nlist?.free();
    query?.free();
  }
}

// ---------------------------------------------------------------------------
// Bond topology: connected components on the molecular graph (no params)
// ---------------------------------------------------------------------------

/**
 * Union–find on atomi/atomj edges. Every atom is a cluster member; isolates
 * form size-1 clusters. No min-size filter and no distance cutoff.
 */
function computeClustersByBonds(
  frame: Frame,
  nParticles: number,
  sortBySize: boolean,
  selectedIndices?: number[],
): ClusterResult {
  const parent = new Int32Array(nParticles);
  for (let i = 0; i < nParticles; i++) parent[i] = i;

  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    let c = x;
    while (parent[c] !== c) {
      const p = parent[c];
      parent[c] = r;
      c = p;
    }
    return r;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  if (bonds && bonds.nRows > 0) {
    const atomi = bonds.has("atomi")
      ? (bonds.view("atomi") as BigUint64Array)
      : null;
    const atomj = bonds.has("atomj")
      ? (bonds.view("atomj") as BigUint64Array)
      : null;
    if (atomi && atomj) {
      const nb = Math.min(atomi.length, atomj.length, bonds.nRows);
      for (let b = 0; b < nb; b++) {
        const i = toRowIndex(atomi[b]);
        const j = toRowIndex(atomj[b]);
        if (i < nParticles && j < nParticles) unite(i, j);
      }
    }
  }

  const selectedSet = selectedIndices ? new Set(selectedIndices) : null;

  // Contiguous IDs in first-seen order (root appearance order).
  const rootToId = new Map<number, number>();
  const sizes: number[] = [];
  const clusterIdx = new Int32Array(nParticles).fill(-1);

  for (let i = 0; i < nParticles; i++) {
    if (selectedSet && !selectedSet.has(i)) continue;
    const root = find(i);
    let id = rootToId.get(root);
    if (id === undefined) {
      id = sizes.length;
      rootToId.set(root, id);
      sizes.push(0);
    }
    clusterIdx[i] = id;
    sizes[id]++;
  }

  const clusterSizes = new Uint32Array(sizes);
  const numClusters = sizes.length;

  if (sortBySize && numClusters > 1) {
    return {
      ...sortClusters(clusterIdx, clusterSizes, numClusters),
      nParticles,
      mode: "bonds" as const,
      rMax: 0,
      minClusterSize: 1,
    };
  }

  return {
    clusterIdx,
    clusterSizes,
    numClusters,
    nParticles,
    mode: "bonds",
    rMax: 0,
    minClusterSize: 1,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortClusters(
  clusterIdx: Int32Array,
  clusterSizes: Uint32Array,
  numClusters: number,
): { clusterIdx: Int32Array; clusterSizes: Uint32Array; numClusters: number } {
  const order = Array.from({ length: numClusters }, (_, i) => i);
  order.sort((a, b) => clusterSizes[b] - clusterSizes[a]);

  const remap = new Int32Array(numClusters);
  for (let newId = 0; newId < numClusters; newId++) {
    remap[order[newId]] = newId;
  }

  const newIdx = new Int32Array(clusterIdx.length);
  for (let i = 0; i < clusterIdx.length; i++) {
    newIdx[i] = clusterIdx[i] >= 0 ? remap[clusterIdx[i]] : -1;
  }

  const newSizes = new Uint32Array(numClusters);
  for (let newId = 0; newId < numClusters; newId++) {
    newSizes[newId] = clusterSizes[order[newId]];
  }

  return { clusterIdx: newIdx, clusterSizes: newSizes, numClusters };
}

function filterBySelection(
  clusterIdx: Int32Array,
  nParticles: number,
  selectedIndices: number[],
  minClusterSize: number,
): { clusterIdx: Int32Array; clusterSizes: Uint32Array; numClusters: number } {
  const filtered = new Int32Array(nParticles).fill(-1);
  for (const idx of selectedIndices) {
    if (idx < clusterIdx.length) filtered[idx] = clusterIdx[idx];
  }

  const sizeMap = new Map<number, number>();
  for (let i = 0; i < nParticles; i++) {
    const c = filtered[i];
    if (c >= 0) sizeMap.set(c, (sizeMap.get(c) ?? 0) + 1);
  }

  const remap = new Map<number, number>();
  const sizes: number[] = [];
  for (const [oldId, size] of sizeMap) {
    if (size >= minClusterSize) {
      remap.set(oldId, sizes.length);
      sizes.push(size);
    }
  }

  const result = new Int32Array(nParticles).fill(-1);
  for (let i = 0; i < nParticles; i++) {
    const c = filtered[i];
    if (c >= 0) result[i] = remap.get(c) ?? -1;
  }

  return {
    clusterIdx: result,
    clusterSizes: new Uint32Array(sizes),
    numClusters: sizes.length,
  };
}
