/**
 * Named cluster mask columns + COM / Rg from mask (no re-clustering).
 *
 * Pipeline contract: each {@link ClusterModifier} writes `cluster_{slot}`
 * (e.g. `cluster_1`). Downstream COM / Rg pick a column explicitly or auto.
 */

import type { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { WasmArray } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";

/** Column name prefix: `cluster_1`, `cluster_2`, … */
export const CLUSTER_COLUMN_PREFIX = "cluster_";

/** @deprecated Prefer {@link clusterColumnName}; kept for one-release read compat. */
export const CLUSTER_MASK_COLUMN = "cluster_mask";

const CLUSTER_SLOT_RE = /^cluster_(\d+)$/;

export function clusterColumnName(slot: number): string {
  const s = Math.max(1, Math.floor(slot));
  return `${CLUSTER_COLUMN_PREFIX}${s}`;
}

export function parseClusterSlot(column: string): number | null {
  const m = CLUSTER_SLOT_RE.exec(column);
  if (!m) return null;
  return Number.parseInt(m[1], 10);
}

/** True for `cluster_1`… and legacy `cluster_mask`. */
export function isClusterMaskColumn(name: string): boolean {
  return name === CLUSTER_MASK_COLUMN || CLUSTER_SLOT_RE.test(name);
}

/**
 * List cluster mask columns on the atoms block, sorted by slot ascending.
 * Legacy `cluster_mask` is appended last if present.
 */
export function listClusterColumns(frame: Frame): string[] {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return [];
  const numbered: { slot: number; name: string }[] = [];
  let legacy = false;
  for (const key of atoms.keys() as string[]) {
    const slot = parseClusterSlot(key);
    if (slot !== null && atoms.dtype(key) !== undefined) {
      numbered.push({ slot, name: key });
    } else if (key === CLUSTER_MASK_COLUMN && atoms.dtype(key) !== undefined) {
      legacy = true;
    }
  }
  numbered.sort((a, b) => a.slot - b.slot);
  const names = numbered.map((e) => e.name);
  if (legacy) names.push(CLUSTER_MASK_COLUMN);
  return names;
}

/**
 * Resolve which mask column to use.
 * @param preferred Explicit column; if missing on frame, falls through to auto.
 * @returns column name or null
 */
export function resolveClusterColumn(
  frame: Frame,
  preferred?: string | null,
): string | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;
  if (preferred) {
    if (atoms.dtype(preferred) !== undefined) return preferred;
  }
  const cols = listClusterColumns(frame);
  return cols.length > 0 ? cols[cols.length - 1] : null;
}

export interface ClusterMaskPropertiesParams {
  /** Per-particle masses. If omitted, uniform mass 1.0. */
  masses?: Float64Array | null;
  /** When true (default), try to read atoms.`mass` if present. */
  useMassColumn?: boolean;
}

export interface ClusterMaskPropertiesResult {
  /** Contiguous cluster ids present in the mask (sorted ascending). */
  clusterIds: Int32Array;
  /** COM per cluster, flat [x0,y0,z0, …]. Length = 3 * numClusters. */
  centersOfMass: Float64Array;
  /** Total mass per cluster. */
  clusterMasses: Float64Array;
  /** Radius of gyration per cluster. */
  radiiOfGyration: Float64Array;
  numClusters: number;
  /** Column that was read. */
  column: string;
}

/**
 * Read a cluster mask column from atoms.
 * @param column Preferred name; omit / null → auto via {@link resolveClusterColumn}.
 */
export function readClusterMask(
  frame: Frame,
  column?: string | null,
): { mask: Int32Array; column: string } | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;
  const n = atoms.nrows();
  if (n < 1) return null;
  const col = resolveClusterColumn(frame, column);
  if (!col) return null;
  if (atoms.dtype(col) === undefined) return null;
  const mask = atoms.viewColI32(col);
  if (!mask || mask.length < n) return null;
  return {
    mask: mask.length === n ? mask : mask.subarray(0, n),
    column: col,
  };
}

function resolveMasses(
  frame: Frame,
  n: number,
  params: ClusterMaskPropertiesParams,
): Float64Array | null {
  if (params.masses && params.masses.length >= n) {
    return params.masses.length === n
      ? params.masses
      : params.masses.subarray(0, n);
  }
  if (params.useMassColumn !== false) {
    const atoms = frame.getBlock("atoms");
    if (atoms?.dtype("mass") !== undefined) {
      const mass = atoms.viewColF("mass");
      if (mass && mass.length >= n) {
        return mass.length === n ? mass : mass.subarray(0, n);
      }
    }
  }
  return null;
}

/**
 * Group atom indices by non-negative cluster id.
 * Returns sorted cluster ids and parallel index lists.
 */
export function groupByClusterMask(mask: Int32Array): {
  clusterIds: number[];
  groups: number[][];
} {
  const map = new Map<number, number[]>();
  for (let i = 0; i < mask.length; i++) {
    const c = mask[i];
    if (c < 0) continue;
    let g = map.get(c);
    if (!g) {
      g = [];
      map.set(c, g);
    }
    g.push(i);
  }
  const clusterIds = [...map.keys()].sort((a, b) => a - b);
  const groups = clusterIds.map((id) => map.get(id) ?? []);
  return { clusterIds, groups };
}

/**
 * MIC displacement of `point` relative to `ref` (b - a with minimum image).
 * Falls back to open-boundary subtraction when no box.
 */
function micDeltaPoint(
  box: Box | null | undefined,
  ref: [number, number, number],
  point: [number, number, number],
): [number, number, number] {
  if (!box) {
    return [point[0] - ref[0], point[1] - ref[1], point[2] - ref[2]];
  }
  const a = WasmArray.from(
    new Float64Array([ref[0], ref[1], ref[2]]),
    new Uint32Array([1, 3]),
  );
  const b = WasmArray.from(
    new Float64Array([point[0], point[1], point[2]]),
    new Uint32Array([1, 3]),
  );
  try {
    const delta = box.delta(a, b, true);
    try {
      const d = delta.toCopy();
      return [d[0], d[1], d[2]];
    } finally {
      delta.free();
    }
  } finally {
    a.free();
    b.free();
  }
}

/**
 * Compute COM and Rg for each cluster from a per-atom mask.
 * Positions are unwrapped relative to the first atom in each cluster (MIC).
 */
export function computeClusterMaskProperties(
  frame: Frame,
  mask: Int32Array,
  params: ClusterMaskPropertiesParams = {},
  column = "",
): ClusterMaskPropertiesResult | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;
  const n = atoms.nrows();
  if (mask.length < n) return null;

  const coords = viewAtomCoords(atoms);
  if (!coords?.x || !coords.y || !coords.z) return null;

  const masses = resolveMasses(frame, n, params);
  const box = frame.box ?? null;
  const { clusterIds, groups } = groupByClusterMask(
    mask.length === n ? mask : mask.subarray(0, n),
  );
  const numClusters = clusterIds.length;
  const centersOfMass = new Float64Array(numClusters * 3);
  const clusterMasses = new Float64Array(numClusters);
  const radiiOfGyration = new Float64Array(numClusters);

  for (let ci = 0; ci < numClusters; ci++) {
    const idxs = groups[ci];
    if (idxs.length === 0) continue;

    const refI = idxs[0];
    const ref: [number, number, number] = [
      coords.x[refI],
      coords.y[refI],
      coords.z[refI],
    ];

    const ux = new Float64Array(idxs.length);
    const uy = new Float64Array(idxs.length);
    const uz = new Float64Array(idxs.length);
    let mSum = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;

    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      const d = micDeltaPoint(box, ref, [
        coords.x[i],
        coords.y[i],
        coords.z[i],
      ]);
      ux[k] = ref[0] + d[0];
      uy[k] = ref[1] + d[1];
      uz[k] = ref[2] + d[2];
      const m = masses ? masses[i] : 1;
      mSum += m;
      cx += m * ux[k];
      cy += m * uy[k];
      cz += m * uz[k];
    }

    if (mSum <= 0) mSum = idxs.length;
    cx /= mSum;
    cy /= mSum;
    cz /= mSum;

    centersOfMass[ci * 3] = cx;
    centersOfMass[ci * 3 + 1] = cy;
    centersOfMass[ci * 3 + 2] = cz;
    clusterMasses[ci] = mSum;

    let rg2 = 0;
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      const m = masses ? masses[i] : 1;
      const dx = ux[k] - cx;
      const dy = uy[k] - cy;
      const dz = uz[k] - cz;
      rg2 += m * (dx * dx + dy * dy + dz * dz);
    }
    radiiOfGyration[ci] = Math.sqrt(rg2 / mSum);
  }

  return {
    clusterIds: Int32Array.from(clusterIds),
    centersOfMass,
    clusterMasses,
    radiiOfGyration,
    numClusters,
    column,
  };
}

/**
 * Build a chart-friendly summary from a mask (sizes histogram source).
 */
export function summarizeClusterMask(mask: Int32Array): {
  clusterIdx: Int32Array;
  clusterSizes: Uint32Array;
  numClusters: number;
} {
  const { clusterIds, groups } = groupByClusterMask(mask);
  const numClusters = clusterIds.length;
  const remap = new Map(clusterIds.map((id, i) => [id, i]));
  const clusterIdx = new Int32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const c = mask[i];
    clusterIdx[i] = c < 0 ? -1 : (remap.get(c) ?? -1);
  }
  const clusterSizes = new Uint32Array(numClusters);
  for (let i = 0; i < numClusters; i++) {
    clusterSizes[i] = groups[i].length;
  }
  return { clusterIdx, clusterSizes, numClusters };
}
