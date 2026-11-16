/**
 * Connected pores of a field on a periodic cell.
 *
 * A pore is a connected set of void voxels (`value <= isovalue`, the outside
 * of a positive-inside envelope), with face (6-) connectivity and the cell's
 * periodicity: a pore that leaves through one face and comes back through
 * the opposite one is one pore, not two.
 *
 * Union-find carries, for every voxel, its lattice offset to its root — how
 * many cells over it sits from the root's image. Joining two voxels already
 * in one set with offsets that disagree closes a loop around the torus: the
 * pore wraps onto its own periodic image along that difference. The rank of
 * all such wrap vectors is the pore's spanning dimension: 0 for a closed
 * cavity, 1 for a channel, 2 for a sheet, 3 for a network through the cell.
 */

import type { CellDomain } from "./cell_domain";

export interface Pore {
  /** Voxel count. */
  voxels: number;
  /** Volume, Å³. */
  volume: number;
  /** Spanning dimension, 0..3. */
  dimension: number;
}

export interface PoreLabels {
  /** Pore index per voxel, by decreasing volume; −1 for solid. */
  labels: Int32Array;
  /** Pores, largest first. */
  pores: Pore[];
  /** Void volume / cell volume. */
  voidFraction: number;
}

type Vec3 = [number, number, number];

class OffsetUnionFind {
  readonly parent: Int32Array;
  /** Lattice offset of each voxel relative to its parent, 3 per voxel. */
  readonly offset: Int32Array;
  readonly wraps = new Map<number, Vec3[]>();

  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.offset = new Int32Array(3 * n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }

  /** Root of `i`, with `i`'s offset to it; compresses the path. */
  find(i: number): [number, Vec3] {
    const path: number[] = [];
    let r = i;
    while (this.parent[r] !== r) {
      path.push(r);
      r = this.parent[r];
    }
    // Walk back from the node nearest the root, accumulating offsets.
    let acc: Vec3 = [0, 0, 0];
    for (let k = path.length - 1; k >= 0; k--) {
      const v = path[k];
      acc = [
        acc[0] + this.offset[3 * v],
        acc[1] + this.offset[3 * v + 1],
        acc[2] + this.offset[3 * v + 2],
      ];
      this.parent[v] = r;
      this.offset[3 * v] = acc[0];
      this.offset[3 * v + 1] = acc[1];
      this.offset[3 * v + 2] = acc[2];
    }
    return [
      r,
      path.length
        ? [this.offset[3 * i], this.offset[3 * i + 1], this.offset[3 * i + 2]]
        : [0, 0, 0],
    ];
  }

  /** Join `a` and `b`, where `b`'s image sits at `a` + `shift` cells. */
  union(a: number, b: number, shift: Vec3): void {
    const [ra, oa] = this.find(a);
    const [rb, ob] = this.find(b);
    // Position of b's root image relative to a's root: oa + shift − ob.
    const d: Vec3 = [
      oa[0] + shift[0] - ob[0],
      oa[1] + shift[1] - ob[1],
      oa[2] + shift[2] - ob[2],
    ];
    if (ra === rb) {
      if (d[0] || d[1] || d[2]) {
        const list = this.wraps.get(ra) ?? [];
        list.push(d);
        this.wraps.set(ra, list);
      }
      return;
    }
    this.parent[rb] = ra;
    this.offset[3 * rb] = d[0];
    this.offset[3 * rb + 1] = d[1];
    this.offset[3 * rb + 2] = d[2];
    const moved = this.wraps.get(rb);
    if (moved) {
      this.wraps.set(ra, [...(this.wraps.get(ra) ?? []), ...moved]);
      this.wraps.delete(rb);
    }
  }
}

/** Rank of a set of integer 3-vectors. */
export function latticeRank(vectors: readonly Vec3[]): number {
  const basis: number[][] = [];
  for (const v of vectors) {
    const r = [...v];
    for (const b of basis) {
      const pivot = b.findIndex((x) => x !== 0);
      if (r[pivot] !== 0) {
        const f = r[pivot] / b[pivot];
        for (let k = 0; k < 3; k++) r[k] -= f * b[k];
      }
    }
    if (r.some((x) => Math.abs(x) > 1e-9)) basis.push(r);
    if (basis.length === 3) break;
  }
  return basis.length;
}

/**
 * Label the void of `values` on `domain` into periodic pores.
 *
 * @param isovalue - The envelope's level; void is `value <= isovalue`.
 */
export function labelPores(
  domain: Pick<CellDomain, "shape" | "steps">,
  values: Float64Array,
  isovalue: number,
): PoreLabels {
  const [nx, ny, nz] = domain.shape;
  const n = nx * ny * nz;
  const uf = new OffsetUnionFind(n);
  const isVoid = (i: number): boolean => values[i] <= isovalue;
  const index = (i: number, j: number, k: number): number =>
    (i * ny + j) * nz + k;
  let voidCount = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        const a = index(i, j, k);
        if (!isVoid(a)) continue;
        voidCount++;
        // +x, +y, +z neighbours; the wrap carries a one-cell shift.
        const steps: [number, Vec3][] = [
          [index((i + 1) % nx, j, k), [i + 1 === nx ? 1 : 0, 0, 0]],
          [index(i, (j + 1) % ny, k), [0, j + 1 === ny ? 1 : 0, 0]],
          [index(i, j, (k + 1) % nz), [0, 0, k + 1 === nz ? 1 : 0]],
        ];
        for (const [b, shift] of steps) {
          if (isVoid(b)) uf.union(a, b, shift);
        }
      }
    }
  }

  const sizes = new Map<number, number>();
  const rootOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!isVoid(i)) continue;
    const [r] = uf.find(i);
    rootOf[i] = r;
    sizes.set(r, (sizes.get(r) ?? 0) + 1);
  }
  const voxelVolume = domain.steps[0] * domain.steps[1] * domain.steps[2];
  const roots = [...sizes.keys()].sort(
    (a, b) => (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0),
  );
  const rank = new Map(roots.map((r, k) => [r, k]));
  const labels = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++)
    if (rootOf[i] >= 0) labels[i] = rank.get(rootOf[i]) ?? -1;
  const pores = roots.map((r) => {
    const voxels = sizes.get(r) ?? 0;
    return {
      voxels,
      volume: voxels * voxelVolume,
      dimension: latticeRank(uf.wraps.get(r) ?? []),
    };
  });
  return { labels, pores, voidFraction: voidCount / n };
}

/**
 * Pore of each vertex of a void surface: the label of the probe-centre
 * region one probe radius in from the vertex, along the void field's
 * gradient. A point on the swept surface is exactly one probe radius from
 * the centre that swept it, so this finds that centre's pore; the nearest
 * labelled voxel within `search` voxels absorbs grid rounding. −1 when no
 * labelled voxel is in reach.
 *
 * @param voidField - Positive in the void (the negated envelope).
 * @param labels - Pore label per voxel of the centre region (−1 elsewhere).
 * @param reach - Probe radius, Å.
 */
export function vertexPores(
  positions: Float32Array,
  domain: Pick<CellDomain, "shape" | "steps" | "origin">,
  voidField: Float64Array,
  labels: Int32Array,
  reach: number,
  search = 2,
): Int32Array {
  const [nx, ny, nz] = domain.shape;
  const [hx, hy, hz] = domain.steps;
  const wrap = (v: number, m: number): number => ((v % m) + m) % m;
  const flat = new Float32Array(positions.length);
  const inward = gradientNormals(positions, flat, domain, voidField, false);
  const out = new Int32Array(positions.length / 3).fill(-1);
  for (let v = 0; v < out.length; v++) {
    const fx =
      (positions[3 * v] + reach * inward[3 * v] - domain.origin[0]) / hx;
    const fy =
      (positions[3 * v + 1] + reach * inward[3 * v + 1] - domain.origin[1]) /
      hy;
    const fz =
      (positions[3 * v + 2] + reach * inward[3 * v + 2] - domain.origin[2]) /
      hz;
    const [ci, cj, ck] = [Math.round(fx), Math.round(fy), Math.round(fz)];
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let di = -search; di <= search; di++) {
      for (let dj = -search; dj <= search; dj++) {
        for (let dk = -search; dk <= search; dk++) {
          const label =
            labels[
              (wrap(ci + di, nx) * ny + wrap(cj + dj, ny)) * nz +
                wrap(ck + dk, nz)
            ];
          if (label < 0) continue;
          const d =
            (ci + di - fx) ** 2 + (cj + dj - fy) ** 2 + (ck + dk - fz) ** 2;
          if (d < bestDistance) {
            bestDistance = d;
            best = label;
          }
        }
      }
    }
    out[v] = best;
  }
  return out;
}

/**
 * Smooth vertex normals from the field's gradient (central differences,
 * periodic), trilinearly interpolated at each vertex and pointed the way the
 * flat normal already points (or, with `alignToFlat` false, up the field's
 * gradient). The vertices do not move, so a narrow channel stays exactly as
 * narrow; only the shading stops showing the voxel facets.
 */
export function gradientNormals(
  positions: Float32Array,
  flat: Float32Array,
  domain: Pick<CellDomain, "shape" | "steps" | "origin">,
  values: Float64Array,
  alignToFlat = true,
): Float32Array {
  const [nx, ny, nz] = domain.shape;
  const [hx, hy, hz] = domain.steps;
  const wrap = (v: number, m: number): number => ((v % m) + m) % m;
  const at = (i: number, j: number, k: number): number =>
    values[(wrap(i, nx) * ny + wrap(j, ny)) * nz + wrap(k, nz)];
  const grad = (i: number, j: number, k: number): Vec3 => [
    (at(i + 1, j, k) - at(i - 1, j, k)) / (2 * hx),
    (at(i, j + 1, k) - at(i, j - 1, k)) / (2 * hy),
    (at(i, j, k + 1) - at(i, j, k - 1)) / (2 * hz),
  ];
  const out = new Float32Array(positions.length);
  for (let v = 0; v < positions.length / 3; v++) {
    const fx = (positions[3 * v] - domain.origin[0]) / hx;
    const fy = (positions[3 * v + 1] - domain.origin[1]) / hy;
    const fz = (positions[3 * v + 2] - domain.origin[2]) / hz;
    const [i0, j0, k0] = [Math.floor(fx), Math.floor(fy), Math.floor(fz)];
    const [tx, ty, tz] = [fx - i0, fy - j0, fz - k0];
    const g: Vec3 = [0, 0, 0];
    for (let c = 0; c < 8; c++) {
      const [di, dj, dk] = [c & 1, (c >> 1) & 1, (c >> 2) & 1];
      const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
      const gc = grad(i0 + di, j0 + dj, k0 + dk);
      g[0] += w * gc[0];
      g[1] += w * gc[1];
      g[2] += w * gc[2];
    }
    const len = Math.hypot(g[0], g[1], g[2]);
    const f = [flat[3 * v], flat[3 * v + 1], flat[3 * v + 2]];
    if (len < 1e-12) {
      out.set(f, 3 * v);
      continue;
    }
    const sign =
      alignToFlat && g[0] * f[0] + g[1] * f[1] + g[2] * f[2] < 0 ? -1 : 1;
    out[3 * v] = (sign * g[0]) / len;
    out[3 * v + 1] = (sign * g[1]) / len;
    out[3 * v + 2] = (sign * g[2]) / len;
  }
  return out;
}

/**
 * Clean per-vertex classes by a majority vote over a neighbourhood of
 * `radius` Å: votes are summed per cubic cell of that size, and a vertex
 * takes the majority of its cell and the 26 around it. Linear in the vertex
 * count. Unknown vertices (−1) do not vote and take the majority; a vertex
 * with no known neighbour is class 1. Ties keep the vertex's own class.
 */
export function majorityClasses(
  positions: Float32Array,
  raw: Int8Array,
  radius: number,
): Float32Array {
  const n = raw.length;
  if (n === 0) return new Float32Array(0);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], positions[3 * v + a]);
      hi[a] = Math.max(hi[a], positions[3 * v + a]);
    }
  const dims = [0, 1, 2].map((a) => Math.floor((hi[a] - lo[a]) / radius) + 1);
  const cellOf = (v: number, a: number): number =>
    Math.floor((positions[3 * v + a] - lo[a]) / radius);
  const flat = (i: number, j: number, k: number): number =>
    (i * dims[1] + j) * dims[2] + k;
  const votes = new Uint32Array(2 * dims[0] * dims[1] * dims[2]);
  for (let v = 0; v < n; v++) {
    if (raw[v] < 0) continue;
    votes[2 * flat(cellOf(v, 0), cellOf(v, 1), cellOf(v, 2)) + raw[v]]++;
  }
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const [ci, cj, ck] = [cellOf(v, 0), cellOf(v, 1), cellOf(v, 2)];
    let zero = 0;
    let one = 0;
    for (let i = Math.max(0, ci - 1); i <= Math.min(dims[0] - 1, ci + 1); i++)
      for (let j = Math.max(0, cj - 1); j <= Math.min(dims[1] - 1, cj + 1); j++)
        for (
          let k = Math.max(0, ck - 1);
          k <= Math.min(dims[2] - 1, ck + 1);
          k++
        ) {
          const c = flat(i, j, k);
          zero += votes[2 * c];
          one += votes[2 * c + 1];
        }
    if (zero === one) out[v] = raw[v] < 0 ? 1 : raw[v];
    else out[v] = zero > one ? 0 : 1;
  }
  return out;
}
