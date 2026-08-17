import type { Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";

export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Calculate bounding box for a frame from its atoms block.
 * Uses `x/y/z`, or `xu/yu/zu` when wrapped Cartesian coordinates are absent.
 * @param frame The frame to inspect
 * @param padding Optional padding to add to the box
 * @returns BoundingBox or null if no atoms
 */
export function calculateBoundingBox(
  frame: Frame,
  padding = 0.0,
): BoundingBox | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;

  const coords = viewAtomCoords(atoms);
  const x = coords?.x;
  const y = coords?.y;
  const z = coords?.z;

  if (!x || !y || !z || x.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  const count = x.length;
  for (let i = 0; i < count; i++) {
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
    if (z[i] < minZ) minZ = z[i];
    if (z[i] > maxZ) maxZ = z[i];
  }

  if (padding !== 0.0) {
    minX -= padding;
    minY -= padding;
    minZ -= padding;
    maxX += padding;
    maxY += padding;
    maxZ += padding;
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}
