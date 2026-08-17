import { type TargetCamera, Vector3 } from "@babylonjs/core";

/**
 * A 3-component vector expressed as a plain tuple. Camera trajectories are
 * pure data (serializable, WASM-free), so poses use tuples rather than
 * BabylonJS {@link Vector3} — the conversion happens only at {@link applyPose}.
 */
export type Vec3 = readonly [number, number, number];

/**
 * A camera pose — a rig-agnostic snapshot of where the camera is and what it
 * looks at. Trajectories are modeled as `t -> CameraPose`, never as
 * `ArcRotateCamera` alpha/beta/radius, so any future track kind (fly-through,
 * keyframe path) reuses the same animator unchanged.
 *
 * `up` and `fov` are optional: when omitted, {@link applyPose} leaves the
 * camera's current values untouched.
 */
export interface CameraPose {
  /** World-space camera position, in Å. */
  readonly position: Vec3;
  /** World-space look-at target, in Å. */
  readonly target: Vec3;
  /** World up vector. Omit to keep the camera's current up. */
  readonly up?: Vec3;
  /** Vertical field of view, in radians. Omit to keep the camera's current fov. */
  readonly fov?: number;
}

/**
 * Position a BabylonJS target camera from a {@link CameraPose}. Omitted
 * `up`/`fov` are left at the camera's current values (inheritance default).
 */
export function applyPose(camera: TargetCamera, pose: CameraPose): void {
  camera.position = new Vector3(
    pose.position[0],
    pose.position[1],
    pose.position[2],
  );
  camera.setTarget(new Vector3(pose.target[0], pose.target[1], pose.target[2]));
  if (pose.up) {
    camera.upVector = new Vector3(pose.up[0], pose.up[1], pose.up[2]);
  }
  if (pose.fov !== undefined) {
    camera.fov = pose.fov;
  }
}
