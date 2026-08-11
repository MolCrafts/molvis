/**
 * Camera-facing orientation for edit-mode molecule stamps.
 *
 * Template coordinates (relative to molecule center) are remapped onto the
 * current camera screen basis so a structure faces the viewer when placed.
 *
 * Uses the project-verified Z-up {@link viewBasis} (α/β), not
 * `camera.getDirection` — Babylon's local Right/Up/Forward axes do not match
 * MolVis's Z-up ArcRotateCamera and produced wrong stamp orientations.
 */

import { type ArcRotateCamera, type Camera, Vector3 } from "@babylonjs/core";
import { viewBasis } from "../camera/fit";

/**
 * Orthonormal basis for stamp orientation.
 *
 * - `right` — screen X (template +x)
 * - `up` — screen Y (template +y)
 * - `out` — toward the camera / viewer (template +z)
 */
export interface PlacementBasis {
  right: Vector3;
  up: Vector3;
  out: Vector3;
}

/** Identity basis: template axes = world axes (no camera reorientation). */
export function identityPlacementBasis(): PlacementBasis {
  return {
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    out: new Vector3(0, 0, 1),
  };
}

function isArcRotateCamera(camera: Camera): camera is ArcRotateCamera {
  return (
    typeof (camera as ArcRotateCamera).alpha === "number" &&
    typeof (camera as ArcRotateCamera).beta === "number"
  );
}

/**
 * Build a camera-facing stamp basis from the interactive ArcRotateCamera.
 *
 * Template +x → screen right, +y → screen up, +z → toward the viewer.
 * Flat 2D-ish templates (z≈0) land parallel to the screen plane.
 */
export function cameraFacingBasis(camera: Camera): PlacementBasis {
  if (isArcRotateCamera(camera)) {
    const basis = viewBasis(camera.alpha, camera.beta);
    // viewBasis.forward = look direction (into the scene).
    // out = toward the viewer = −forward.
    return {
      right: new Vector3(basis.right[0], basis.right[1], basis.right[2]),
      up: new Vector3(basis.up[0], basis.up[1], basis.up[2]),
      out: new Vector3(-basis.forward[0], -basis.forward[1], -basis.forward[2]),
    };
  }

  // Fallback for non-arc cameras: derive from world matrix columns carefully.
  // Prefer the verified α/β path above whenever possible.
  const inv = camera.getWorldMatrix().clone().invert();
  // Camera world X/Y columns ≈ right/up in LH; RH + Z-up scenes vary —
  // only used if ArcRotateCamera is unavailable.
  const right = Vector3.TransformNormal(new Vector3(1, 0, 0), inv).normalize();
  const up = Vector3.TransformNormal(new Vector3(0, 1, 0), inv).normalize();
  const forward = Vector3.TransformNormal(
    new Vector3(0, 0, 1),
    inv,
  ).normalize();
  return {
    right,
    up,
    out: forward.scale(-1),
  };
}

/**
 * Map a template-local offset (relative to molecule center) into world space
 * via the placement basis. Does not add the click target.
 */
export function orientLocalOffset(
  lx: number,
  ly: number,
  lz: number,
  basis: PlacementBasis,
): Vector3 {
  return basis.right.scale(lx).add(basis.up.scale(ly)).add(basis.out.scale(lz));
}
