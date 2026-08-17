/**
 * Fence selection against the live scene meta registry.
 *
 * Fence must read {@link AtomSource} / {@link BondSource} (frame + edit
 * overlay), not `system.frame` alone — edit-only atoms from sketch / place /
 * draw are invisible to the trajectory frame until commit.
 */

import type { AtomSource, BondSource } from "../entity_source";
import { type Point2D, pointInPolygon } from "./fence";

export interface FenceWorldPoint {
  id: number;
  x: number;
  y: number;
  z: number;
}

/** Logical atom ids + world positions currently in the scene. */
export function fenceAtomWorldPoints(atoms: AtomSource): FenceWorldPoint[] {
  const out: FenceWorldPoint[] = [];
  for (const atomId of atoms.getAllIds()) {
    const meta = atoms.getMeta(atomId);
    if (!meta) continue;
    out.push({
      id: meta.atomId,
      x: meta.position.x,
      y: meta.position.y,
      z: meta.position.z,
    });
  }
  return out;
}

/** Logical bond ids + bond midpoints currently in the scene. */
export function fenceBondWorldPoints(bonds: BondSource): FenceWorldPoint[] {
  const out: FenceWorldPoint[] = [];
  for (const bondId of bonds.getAllIds()) {
    const meta = bonds.getMeta(bondId);
    if (!meta) continue;
    out.push({
      id: meta.bondId,
      x: (meta.start.x + meta.end.x) * 0.5,
      y: (meta.start.y + meta.end.y) * 0.5,
      z: (meta.start.z + meta.end.z) * 0.5,
    });
  }
  return out;
}

/**
 * Return ids whose projected screen point lies inside the fence polygon.
 * `project` maps world → screen (CSS pixel space matching pointer events).
 */
export function selectIdsInPolygon(
  polygon: Point2D[],
  points: Iterable<FenceWorldPoint>,
  project: (x: number, y: number, z: number) => Point2D,
): number[] {
  const selected: number[] = [];
  for (const p of points) {
    if (pointInPolygon(project(p.x, p.y, p.z), polygon)) {
      selected.push(p.id);
    }
  }
  return selected;
}
