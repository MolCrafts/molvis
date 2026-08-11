import {
  Color3,
  Quaternion,
  type StandardMaterial,
  type TransformNode,
  Vector3,
} from "@babylonjs/core";

/**
 * Canonical world-axis palette for MolVis (right-handed, Z-up).
 * Every axis indicator (corner triad, manipulate arrows/rings, camera-target
 * crosshair) reads from here so X/Y/Z colors can never disagree.
 */
export const WORLD_AXIS_COLORS = {
  x: new Color3(1, 0, 0),
  y: new Color3(0, 1, 0),
  z: new Color3(0, 0, 1),
} as const;

export type WorldAxisKey = keyof typeof WORLD_AXIS_COLORS;

export interface WorldAxis {
  readonly key: WorldAxisKey;
  /** Unit world direction. Treat as immutable — clone before mutating. */
  readonly direction: Vector3;
  readonly color: Color3;
}

/** The X/Y/Z triad every gizmo renders: world direction + shared color. */
export const WORLD_AXES: readonly [WorldAxis, WorldAxis, WorldAxis] = [
  { key: "x", direction: new Vector3(1, 0, 0), color: WORLD_AXIS_COLORS.x },
  { key: "y", direction: new Vector3(0, 1, 0), color: WORLD_AXIS_COLORS.y },
  { key: "z", direction: new Vector3(0, 0, 1), color: WORLD_AXIS_COLORS.z },
];

const WHITE = new Color3(1, 1, 1);

/**
 * Paint a gizmo material in its axis color (hover = lightened toward white).
 * Writes into the material's existing Color3 instances — no allocation.
 */
export function paintAxisMaterial(
  mat: StandardMaterial,
  color: Color3,
  hover = false,
): void {
  if (hover) {
    Color3.LerpToRef(color, WHITE, 0.35, mat.diffuseColor);
  } else {
    mat.diffuseColor.copyFrom(color);
  }
  mat.emissiveColor.copyFrom(mat.diffuseColor).scaleInPlace(0.85);
  mat.specularColor.copyFromFloats(0, 0, 0);
}

const PARALLEL_EPSILON = 1e-6;

/**
 * Orient `node` so `localAxis` (in node-local space) points along `worldAxis`.
 *
 * `Quaternion.FromUnitVectorsToRef` is numerically unstable near 180°, so the
 * anti-parallel case rotates explicitly about an orthogonal axis instead.
 * Reuses the node's existing rotationQuaternion when present (no allocation
 * on re-binding).
 */
export function alignLocalAxisToWorld(
  node: TransformNode,
  localAxis: Vector3,
  worldAxis: Vector3,
): void {
  const local = localAxis.normalizeToNew();
  const target = worldAxis.normalizeToNew();
  const q = node.rotationQuaternion ?? new Quaternion();

  const dot = Vector3.Dot(local, target);
  if (dot > 1 - PARALLEL_EPSILON) {
    q.copyFromFloats(0, 0, 0, 1);
  } else if (dot < -1 + PARALLEL_EPSILON) {
    // 180° about any axis orthogonal to `local`.
    const ortho =
      Math.abs(local.x) < 0.9
        ? Vector3.Cross(local, new Vector3(1, 0, 0)).normalize()
        : Vector3.Cross(local, new Vector3(0, 1, 0)).normalize();
    Quaternion.RotationAxisToRef(ortho, Math.PI, q);
  } else {
    Quaternion.FromUnitVectorsToRef(local, target, q);
  }

  node.rotation.set(0, 0, 0);
  node.rotationQuaternion = q;
}
