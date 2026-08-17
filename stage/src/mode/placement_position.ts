import {
  type ArcRotateCamera,
  type Camera,
  Matrix,
  Plane,
  type Scene,
  Vector3,
} from "@babylonjs/core";

/**
 * Inputs for mapping a 2D canvas pointer to a 3D placement position.
 *
 * Shared by empty-canvas atom place, pending molecule templates
 * (SMILES / sketch / download), and screen-plane atom drag.
 */
export interface PointerSpacePositionInput {
  scene: Scene;
  camera: Camera;
  /** Babylon scene pointer X (CSS px, engine-scaled). */
  pointerX: number;
  /** Babylon scene pointer Y (CSS px, engine-scaled). */
  pointerY: number;
  /**
   * Plane passes through this world point, facing the camera.
   * Defaults to the camera target (or a unit step in front of the camera).
   */
  anchor?: Vector3;
}

/**
 * Unit normal of the screen-aligned placement plane (points toward camera).
 */
export function screenAlignedPlaneNormal(camera: Camera): Vector3 {
  return camera.getDirection(Vector3.Forward()).scale(-1).normalize();
}

/**
 * Origin of the screen-aligned placement plane.
 * Prefer an explicit anchor (e.g. atom being dragged); otherwise camera target.
 */
export function screenAlignedPlaneOrigin(
  camera: Camera,
  anchor?: Vector3,
): Vector3 {
  if (anchor) return anchor;
  const target = (camera as ArcRotateCamera).target;
  if (target) return target;
  return camera.position.add(screenAlignedPlaneNormal(camera));
}

/**
 * Intersect a world-space ray with an infinite plane.
 * Returns null when the ray is parallel to the plane or hits behind the origin.
 */
export function intersectRayWithPlane(
  rayOrigin: Vector3,
  rayDirection: Vector3,
  planeOrigin: Vector3,
  planeNormal: Vector3,
): Vector3 | null {
  const denom = Vector3.Dot(rayDirection, planeNormal);
  if (Math.abs(denom) < 1e-12) return null;
  const t = Vector3.Dot(planeOrigin.subtract(rayOrigin), planeNormal) / denom;
  if (!Number.isFinite(t)) return null;
  return rayOrigin.add(rayDirection.scale(t));
}

/**
 * Resolve a 3D world position from a 2D pointer by casting the camera picking
 * ray onto a screen-aligned plane.
 *
 * This is the single algorithm for “where does a click land in space?” used by
 * Edit (atom / molecule template place) and Manipulate (atom drag).
 *
 * @returns World position, or `null` when the ray misses the plane.
 */
export function resolvePointerSpacePosition(
  input: PointerSpacePositionInput,
): Vector3 | null {
  const { scene, camera, pointerX, pointerY, anchor } = input;
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return null;

  const origin = screenAlignedPlaneOrigin(camera, anchor);
  const normal = screenAlignedPlaneNormal(camera);
  const plane = Plane.FromPositionAndNormal(origin, normal);

  // Babylon's picking ray applies hardware scaling and viewport offsets.
  const ray = scene.createPickingRay(
    pointerX,
    pointerY,
    Matrix.Identity(),
    camera,
  );
  const distance = ray.intersectsPlane(plane);
  if (
    distance === null ||
    distance === undefined ||
    !Number.isFinite(distance)
  ) {
    return null;
  }
  return ray.origin.add(ray.direction.scale(distance));
}
