import type { Frame } from "@molcrafts/molrs";
import { DType } from "../utils/dtype";

/**
 * Derive the scene-supplied inputs a `panelInput` requirement names.
 *
 * Every helper reads only the frame (plus, for `voidMask`, the caller's
 * selection) and returns the flat typed arrays the WASM bindings expect.
 */

/** `[i, j]` pairs from the frame's bonds block, flattened. */
export function bondPairs(frame: Frame): Uint32Array {
  const bonds = frame.getBlock("bonds");
  if (!bonds || bonds.nrows() === 0) return new Uint32Array(0);
  const i = bonds.copyColU32("atomi");
  const j = bonds.copyColU32("atomj");
  const out = new Uint32Array(i.length * 2);
  for (let k = 0; k < i.length; k++) {
    out[2 * k] = i[k];
    out[2 * k + 1] = j[k];
  }
  return out;
}

/** Adjacency list built from the bonds block. */
function adjacency(frame: Frame): number[][] {
  const atoms = frame.getBlock("atoms");
  const n = atoms?.nrows() ?? 0;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const bonds = frame.getBlock("bonds");
  if (!bonds || bonds.nrows() === 0) return adj;
  const i = bonds.copyColU32("atomi");
  const j = bonds.copyColU32("atomj");
  for (let k = 0; k < i.length; k++) {
    if (i[k] < n && j[k] < n) {
      adj[i[k]].push(j[k]);
      adj[j[k]].push(i[k]);
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
  const atoms = frame.getBlock("atoms");
  const n = atoms?.nrows() ?? 0;
  if (!atoms || n === 0) return new Int32Array(0);

  const candidates = preferred ? [preferred, ...LABEL_COLUMNS] : LABEL_COLUMNS;
  for (const column of candidates) {
    const dtype = atoms.dtype(column);
    if (dtype === undefined) continue;
    if (dtype === DType.String) {
      const values = atoms.copyColStr(column);
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
    if (dtype === DType.U32) return Int32Array.from(atoms.copyColU32(column));
    if (dtype === DType.I32) return atoms.copyColI32(column);
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
