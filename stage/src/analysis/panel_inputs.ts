import { toRowIndex } from "@molcrafts/molvis-core";
import type { Frame } from "@molcrafts/molvis-core/molrs";
import { DType } from "../utils/dtype";

/**
 * Derive the scene-supplied inputs a `panelInput` requirement names.
 *
 * Every helper reads only the frame (plus, for `voidMask`, the caller's
 * selection) and returns the flat typed arrays the WASM bindings expect.
 */

/** `[i, j]` pairs from the frame's bonds block, flattened. */
export function bondPairs(frame: Frame): Uint32Array {
  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  if (!bonds || bonds.nRows === 0) return new Uint32Array(0);
  const i = bonds.copy("atomi") as BigUint64Array;
  const j = bonds.copy("atomj") as BigUint64Array;
  const out = new Uint32Array(i.length * 2);
  for (let k = 0; k < i.length; k++) {
    out[2 * k] = toRowIndex(i[k]);
    out[2 * k + 1] = toRowIndex(j[k]);
  }
  return out;
}

/** Adjacency list built from the bonds block. */
function adjacency(frame: Frame): number[][] {
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  const n = atoms?.nRows ?? 0;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
  if (!bonds || bonds.nRows === 0) return adj;
  const i = bonds.copy("atomi") as BigUint64Array;
  const j = bonds.copy("atomj") as BigUint64Array;
  for (let k = 0; k < i.length; k++) {
    const ii = toRowIndex(i[k]);
    const jj = toRowIndex(j[k]);
    if (ii < n && jj < n) {
      adj[ii].push(jj);
      adj[jj].push(ii);
    }
  }
  return adj;
}

/**
 * Angle triples `(i, j, k)` where `j` is the vertex — every pair of distinct
 * neighbours of each atom, counted once.
 */
export function angleTriples(frame: Frame): Uint32Array {
  const adj = adjacency(frame);
  const out: number[] = [];
  for (let j = 0; j < adj.length; j++) {
    const neighbors = adj[j];
    for (let a = 0; a < neighbors.length; a++) {
      for (let b = a + 1; b < neighbors.length; b++) {
        out.push(neighbors[a], j, neighbors[b]);
      }
    }
  }
  return new Uint32Array(out);
}

/**
 * Dihedral quads `(i, j, k, l)` along every bond `j–k`, taking one neighbour
 * of `j` and one of `k` outside the bond. Emitted once per `j < k`.
 */
export function dihedralQuads(frame: Frame): Uint32Array {
  const adj = adjacency(frame);
  const out: number[] = [];
  for (let j = 0; j < adj.length; j++) {
    for (const k of adj[j]) {
      if (k <= j) continue;
      for (const i of adj[j]) {
        if (i === k) continue;
        for (const l of adj[k]) {
          if (l === j || l === i) continue;
          out.push(i, j, k, l);
        }
      }
    }
  }
  return new Uint32Array(out);
}

/** Canonical columns a Voronoi domain label may be interned from. */
const LABEL_COLUMNS = ["element", "mol_id", "type"];

/**
 * Integer labels for Voronoi domain analysis, one per atom. String columns are
 * interned to dense ids; numeric columns pass through.
 */
export function atomLabels(frame: Frame, preferred?: string): Int32Array {
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  const n = atoms?.nRows ?? 0;
  if (!atoms || n === 0) return new Int32Array(0);

  const candidates = preferred ? [preferred, ...LABEL_COLUMNS] : LABEL_COLUMNS;
  for (const column of candidates) {
    if (!atoms.has(column)) continue;
    const dtype = atoms.dtype(column);
    if (dtype === DType.String) {
      const values = atoms.copy(column) as string[];
      const ids = new Map<string, number>();
      const out = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const key = String(values[i]);
        let id = ids.get(key);
        if (id === undefined) {
          id = ids.size;
          ids.set(key, id);
        }
        out[i] = id;
      }
      return out;
    }
    if (dtype === DType.Uint) {
      return Int32Array.from(atoms.copy(column) as BigUint64Array, (v) =>
        toRowIndex(v),
      );
    }
    if (dtype === DType.Int) return atoms.copy(column) as Int32Array;
  }
  throw new Error(
    `Voronoi domain analysis needs one of ${LABEL_COLUMNS.join(", ")} on the atoms block`,
  );
}

/** A `0/1` probe mask over all atoms, set for every index in `selected`. */
export function voidMask(
  atomCount: number,
  selected: readonly number[],
): Uint8Array {
  const mask = new Uint8Array(atomCount);
  for (const index of selected) {
    if (index >= 0 && index < atomCount) mask[index] = 1;
  }
  return mask;
}
