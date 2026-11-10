/**
 * Voxel domain shared by every molecular-surface scalar field.
 *
 * The domain is the **atom AABB + pad with `pbc = false`**, never the
 * crystallographic cell. Depositing on `frame.box` folds ASU atoms into the
 * primary cell while Particles still draw at deposited Cartn — the "surface
 * wrapped, protein not" bug. See `.claude/notes/open-questions.md`
 * (coordinate wrap).
 *
 * Voxel convention matches {@link ../marching_cubes} and molrs
 * `Grid.voxel_position`:
 *
 *   world = origin + (i/nx)*col0 + (j/ny)*col1 + (k/nz)*col2
 *
 * so `cell` spans the whole domain and voxel `i` sits exactly at
 * `origin + i*spacing`. Data layout is row-major with ix outermost:
 * `data[ix*ny*nz + iy*nz + iz]`.
 */

/** Hard ceiling on voxels, so a fine resolution cannot exhaust memory. */
export const MAX_VOXELS = 4_000_000;

/** Smallest grid marching cubes can mesh is 2×2×2 (one cell). */
const MIN_AXIS = 2;

/**
 * What a scalar field needs to know about the voxels it fills.
 *
 * Voxel `i` along an axis sits at `origin + i * steps[axis]`, and
 * `cell` (column-major) spans `n * steps` per axis, which is the
 * {@link ../marching_cubes} convention. A `periodic` domain wraps: voxel
 * `n` is voxel `0`, so kernels fold across the faces and marching cubes
 * runs its periodic pass.
 */
export interface FieldDomain {
  readonly origin: Float64Array;
  readonly cell: Float64Array;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** Voxel spacing per axis, Å. */
  readonly steps: readonly [number, number, number];
  /** Largest of {@link steps}; the resolution a report quotes. */
  readonly spacing: number;
  readonly periodic: boolean;
  readonly clamped: boolean;
  readonly shape: [number, number, number];
  readonly voxelCount: number;
  index(i: number, j: number, k: number): number;
}

export interface GridDomainOptions {
  /** Padding beyond the atom AABB, Å. Must cover the largest kernel reach. */
  pad: number;
  /** Target voxel spacing, Å. Raised when the voxel ceiling would be passed. */
  spacing: number;
}

/**
 * Construct from atom coordinates, then read `origin` / `cell` / shape.
 *
 * The requested `spacing` is honoured exactly unless the resulting voxel
 * count would exceed {@link MAX_VOXELS}; then it is scaled up and
 * {@link clamped} reports that it happened, so the UI can say so rather
 * than silently producing a coarser surface than asked for.
 */
export class GridDomain implements FieldDomain {
  readonly origin: Float64Array;
  readonly cell: Float64Array;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly spacing: number;
  readonly steps: readonly [number, number, number];
  readonly periodic = false;
  readonly clamped: boolean;

  constructor(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    z: ArrayLike<number>,
    count: number,
    options: GridDomainOptions,
  ) {
    const pad = Math.max(0, options.pad);
    const extent = boundingExtent(x, y, z, count, pad);
    const spacing = fitSpacing(extent, Math.max(1e-3, options.spacing));

    this.spacing = spacing.value;
    this.steps = [spacing.value, spacing.value, spacing.value];
    this.clamped = spacing.clamped;
    this.nx = axisCount(extent.lx, this.spacing);
    this.ny = axisCount(extent.ly, this.spacing);
    this.nz = axisCount(extent.lz, this.spacing);
    this.origin = new Float64Array([extent.minX, extent.minY, extent.minZ]);
    // Column-major 3×3 spanning the whole domain, so voxel i lands on
    // origin + i*spacing under the i/nx convention.
    this.cell = new Float64Array([
      this.nx * this.spacing,
      0,
      0,
      0,
      this.ny * this.spacing,
      0,
      0,
      0,
      this.nz * this.spacing,
    ]);
  }

  get shape(): [number, number, number] {
    return [this.nx, this.ny, this.nz];
  }

  get voxelCount(): number {
    return this.nx * this.ny * this.nz;
  }

  /** Flat index into a field array, row-major with ix outermost. */
  index(i: number, j: number, k: number): number {
    return (i * this.ny + j) * this.nz + k;
  }

  /** World-space centre of voxel (i, j, k). */
  worldX(i: number): number {
    return this.origin[0] + i * this.spacing;
  }
  worldY(j: number): number {
    return this.origin[1] + j * this.spacing;
  }
  worldZ(k: number): number {
    return this.origin[2] + k * this.spacing;
  }

  /** A zero-filled field sized for this domain. */
  allocate(): Float64Array {
    return new Float64Array(this.voxelCount);
  }
}

interface Extent {
  minX: number;
  minY: number;
  minZ: number;
  lx: number;
  ly: number;
  lz: number;
}

/** Atom AABB grown by `pad` on every side, with a floor for a lone atom. */
function boundingExtent(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  z: ArrayLike<number>,
  count: number,
  pad: number,
): Extent {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const xi = x[i];
    const yi = y[i];
    const zi = z[i];
    if (xi < minX) minX = xi;
    if (yi < minY) minY = yi;
    if (zi < minZ) minZ = zi;
    if (xi > maxX) maxX = xi;
    if (yi > maxY) maxY = yi;
    if (zi > maxZ) maxZ = zi;
  }
  if (!Number.isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }
  const minEdge = Math.max(2 * pad, 1);
  return {
    minX: minX - pad,
    minY: minY - pad,
    minZ: minZ - pad,
    lx: Math.max(maxX - minX + 2 * pad, minEdge),
    ly: Math.max(maxY - minY + 2 * pad, minEdge),
    lz: Math.max(maxZ - minZ + 2 * pad, minEdge),
  };
}

/** Voxels along one axis so that `(n-1)*spacing` covers `length`. */
function axisCount(length: number, spacing: number): number {
  return Math.max(MIN_AXIS, Math.ceil(length / spacing) + 1);
}

/** Raise `spacing` until the grid fits under {@link MAX_VOXELS}. */
function fitSpacing(
  extent: Extent,
  requested: number,
): { value: number; clamped: boolean } {
  const voxels = (s: number) =>
    axisCount(extent.lx, s) * axisCount(extent.ly, s) * axisCount(extent.lz, s);
  if (voxels(requested) <= MAX_VOXELS)
    return { value: requested, clamped: false };

  // Isotropic scale-up: voxel count falls as s^-3, so start from the cube
  // root of the overshoot and creep up until it fits.
  let value = requested * Math.cbrt(voxels(requested) / MAX_VOXELS);
  while (voxels(value) > MAX_VOXELS) value *= 1.05;
  return { value, clamped: true };
}
