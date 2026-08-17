/**
 * Pure helpers for multi-atom selection transforms (manipulate mode).
 *
 * No SceneIndex / mesh side effects — callers apply the resulting positions.
 */

import { Quaternion, Vector3 } from "@babylonjs/core";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Centroid of a point cloud, or null when empty. */
export function selectionCentroid(positions: readonly Vec3[]): Vec3 | null {
  if (positions.length === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of positions) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = positions.length;
  return { x: x / n, y: y / n, z: z / n };
}

/** Translate a point by a delta. */
export function translatePoint(p: Vec3, delta: Vec3): Vec3 {
  return { x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z };
}

/**
 * Rotate `p` around `pivot` by quaternion `q`.
 * Result = pivot + q * (p - pivot).
 */
export function rotateAroundPivot(p: Vec3, pivot: Vec3, q: Quaternion): Vec3 {
  const local = new Vector3(p.x - pivot.x, p.y - pivot.y, p.z - pivot.z);
  const rotated = local.applyRotationQuaternion(q);
  return {
    x: pivot.x + rotated.x,
    y: pivot.y + rotated.y,
    z: pivot.z + rotated.z,
  };
}

/**
 * Euler angles in degrees, intrinsic XYZ (Babylon default for rotation).
 * Matches the XYZ order used by {@link Quaternion.FromEulerAngles}.
 */
export function eulerDegreesToQuaternion(
  xDeg: number,
  yDeg: number,
  zDeg: number,
): Quaternion {
  const toRad = Math.PI / 180;
  return Quaternion.FromEulerAngles(xDeg * toRad, yDeg * toRad, zDeg * toRad);
}

/**
 * Convert a quaternion to XYZ Euler degrees (Babylon `toEulerAngles` order).
 */
export function quaternionToEulerDegrees(q: Quaternion): Vec3 {
  const e = q.toEulerAngles();
  const toDeg = 180 / Math.PI;
  return { x: e.x * toDeg, y: e.y * toDeg, z: e.z * toDeg };
}

/** Apply a translation to every point. */
export function translatePoints(
  positions: readonly Vec3[],
  delta: Vec3,
): Vec3[] {
  return positions.map((p) => translatePoint(p, delta));
}

/** Rotate every point around the same pivot. */
export function rotatePointsAroundPivot(
  positions: readonly Vec3[],
  pivot: Vec3,
  q: Quaternion,
): Vec3[] {
  return positions.map((p) => rotateAroundPivot(p, pivot, q));
}
