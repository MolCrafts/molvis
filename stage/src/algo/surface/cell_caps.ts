/**
 * Caps that close a periodic surface where the cell faces cut it.
 *
 * Meshed on a periodic cell, a bulk surface stops at the six faces and
 * leaves the solid open there; seen from outside, the cell then reads as a
 * shell, not a material. Capping fills each face where the field is solid
 * (`value > isovalue`) — the cut face of the material — and leaves the pores
 * open, the usual look of a pore-surface figure.
 *
 * Each face is the voxel slice at index 0 of its axis (index n is the same
 * slice on a periodic grid), triangulated by marching squares: per square,
 * walk the four corners in order, keep the solid ones and the edge
 * crossings, and fan the resulting convex polygon. Opposite faces share the
 * slice, so their caps match, mirrored, as periodic images must.
 */

import type { SurfaceMesh } from "../surface_mesh";
import type { CellDomain } from "./cell_domain";

/** (a, b, c) cyclic, so b × c = a and a polygon walked in (b, c) faces +a. */
const AXES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
];

/** Square corners in walk order, as (Δb, Δc). */
const CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

export function cellCaps(
  domain: Pick<CellDomain, "shape" | "steps" | "origin">,
  values: Float64Array,
  isovalue: number,
): SurfaceMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const shape = domain.shape;
  const lengths = [0, 1, 2].map((axis) => shape[axis] * domain.steps[axis]);

  for (const [a, b, c] of AXES) {
    const nb = shape[b];
    const nc = shape[c];
    const hb = domain.steps[b];
    const hc = domain.steps[c];
    const sample = (ib: number, ic: number): number => {
      const index: [number, number, number] = [0, 0, 0];
      index[b] = ib % nb;
      index[c] = ic % nc;
      return values[(index[0] * shape[1] + index[1]) * shape[2] + index[2]];
    };

    const polygon: [number, number][] = [];
    for (let ib = 0; ib < nb; ib++) {
      for (let ic = 0; ic < nc; ic++) {
        polygon.length = 0;
        for (let corner = 0; corner < 4; corner++) {
          const [db, dc] = CORNERS[corner];
          const [eb, ec] = CORNERS[(corner + 1) % 4];
          const va = sample(ib + db, ic + dc);
          const vb = sample(ib + eb, ic + ec);
          if (va > isovalue) polygon.push([(ib + db) * hb, (ic + dc) * hc]);
          if (va > isovalue !== vb > isovalue) {
            const t = (isovalue - va) / (vb - va);
            polygon.push([
              (ib + db + t * (eb - db)) * hb,
              (ic + dc + t * (ec - dc)) * hc,
            ]);
          }
        }
        if (polygon.length < 3) continue;
        for (const side of [0, 1]) {
          emitFan(polygon, side, a, b, c, lengths[a], domain.origin, {
            positions,
            normals,
            indices,
          });
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

interface MeshArrays {
  positions: number[];
  normals: number[];
  indices: number[];
}

/** One polygon on the low (`side` 0) or high (`side` 1) face of axis `a`. */
function emitFan(
  polygon: readonly (readonly [number, number])[],
  side: number,
  a: number,
  b: number,
  c: number,
  length: number,
  origin: Float64Array,
  out: MeshArrays,
): void {
  const base = out.positions.length / 3;
  const point = [0, 0, 0];
  const normal = [0, 0, 0];
  normal[a] = side === 1 ? 1 : -1;
  for (const [u, v] of polygon) {
    point[a] = origin[a] + side * length;
    point[b] = origin[b] + u;
    point[c] = origin[c] + v;
    out.positions.push(point[0], point[1], point[2]);
    out.normals.push(normal[0], normal[1], normal[2]);
  }
  // The walk is counter-clockwise seen from +a: keep it on the high face,
  // reverse it on the low face, so every cap faces out of the cell.
  for (let t = 1; t + 1 < polygon.length; t++) {
    if (side === 1) out.indices.push(base, base + t, base + t + 1);
    else out.indices.push(base, base + t + 1, base + t);
  }
}

/** Concatenate meshes into one. */
export function mergeMeshes(...meshes: SurfaceMesh[]): SurfaceMesh {
  let vertices = 0;
  let corners = 0;
  for (const m of meshes) {
    vertices += m.positions.length;
    corners += m.indices.length;
  }
  const positions = new Float32Array(vertices);
  const normals = new Float32Array(vertices);
  const indices = new Uint32Array(corners);
  // Classes survive the merge when any part carries them; a part without
  // them is class 0.
  const classes = meshes.some((m) => m.classes)
    ? new Float32Array(vertices / 3)
    : undefined;
  let vOffset = 0;
  let iOffset = 0;
  for (const m of meshes) {
    positions.set(m.positions, vOffset);
    normals.set(m.normals, vOffset);
    if (classes && m.classes) classes.set(m.classes, vOffset / 3);
    const shift = vOffset / 3;
    for (let i = 0; i < m.indices.length; i++) {
      indices[iOffset + i] = m.indices[i] + shift;
    }
    vOffset += m.positions.length;
    iOffset += m.indices.length;
  }
  return classes
    ? { positions, normals, indices, classes }
    : { positions, normals, indices };
}
