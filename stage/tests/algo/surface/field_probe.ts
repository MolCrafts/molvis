/**
 * Shared probes for surface-field tests.
 *
 * Reading a field's zero crossing directly is a sharper check than meshing
 * it and measuring vertices: it isolates the field math from marching cubes.
 * Not a test file — `rstest.config.ts` only collects `*.test.ts`.
 */

import type { FieldDomain } from "../../../src/algo/surface/grid_domain";

export type Point = readonly [number, number, number];

/** Voxel indices nearest a world point, clamped into the grid. */
export function nearestIndex(
  domain: FieldDomain,
  point: Point,
): [number, number, number] {
  const clamp = (v: number, n: number) =>
    Math.max(0, Math.min(n - 1, Math.round(v)));
  return [
    clamp((point[0] - domain.origin[0]) / domain.steps[0], domain.nx),
    clamp((point[1] - domain.origin[1]) / domain.steps[1], domain.ny),
    clamp((point[2] - domain.origin[2]) / domain.steps[2], domain.nz),
  ];
}

/**
 * Distance from `centre` to the field's first zero crossing walking +x.
 *
 * The scan row is offset from `centre` by up to half a voxel in y and z, so
 * the true 3-D distance to the crossing point is returned rather than the
 * x displacement — that keeps the measurement honest for a sphere.
 */
export function crossingDistance(
  domain: FieldDomain,
  values: Float64Array,
  centre: Point,
): number {
  const [i0, j, k] = nearestIndex(domain, centre);
  if (values[domain.index(i0, j, k)] <= 0) {
    throw new Error(
      `field is not positive at the probe origin (value ${values[domain.index(i0, j, k)]}); nothing to cross`,
    );
  }

  for (let i = i0; i < domain.nx - 1; i++) {
    const a = values[domain.index(i, j, k)];
    const b = values[domain.index(i + 1, j, k)];
    if (a > 0 && b <= 0) {
      const t = a / (a - b);
      const [hx, hy, hz] = domain.steps;
      const [ox, oy, oz] = domain.origin;
      const xc = ox + (i + t) * hx;
      return Math.hypot(
        xc - centre[0],
        oy + j * hy - centre[1],
        oz + k * hz - centre[2],
      );
    }
  }
  throw new Error("field never crosses zero along +x within the domain");
}
