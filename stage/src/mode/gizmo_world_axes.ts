/**
 * Force Babylon Position/Rotation gizmo visuals onto the MolVis world axes
 * (+X red, +Y green, +Z blue — same as {@link WORLD_AXIS_COLORS} / axis helper).
 *
 * Babylon builds rings/arrows with `lookAt(planeNormal)`, which does not
 * reliably land on world X/Y/Z under a right-handed Z-up scene. The drag
 * math still uses the correct planeNormal/dragAxis, so the mesh can sit on
 * the wrong axis while the color still says "X" — the ring color then
 * disagrees with the corner triad.
 *
 * We re-orient each sub-gizmo mesh so:
 * - Rotation ring normal = world axis (red ring around +X, …)
 * - Position arrow direction = world axis
 */

import {
  Color3,
  type PositionGizmo,
  Quaternion,
  type RotationGizmo,
  type StandardMaterial,
  type TransformNode,
  Vector3,
} from "@babylonjs/core";
import { WORLD_AXIS_COLORS } from "../axis_helper";

const WORLD_X = new Vector3(1, 0, 0);
const WORLD_Y = new Vector3(0, 1, 0);
const WORLD_Z = new Vector3(0, 0, 1);

/**
 * Babylon CreateTorus lies in XY (hole along +Z). After the gizmo's
 * `rotation.x = π/2`, that hole maps to local −Y of `_gizmoMesh`.
 */
const TORUS_LOCAL_NORMAL = new Vector3(0, -1, 0);
/** AxisDragGizmo arrow points along local +Z of `_gizmoMesh`. */
const ARROW_LOCAL_FORWARD = new Vector3(0, 0, 1);

type GizmoMeshHost = {
  /** @internal Babylon marks these private; present at runtime. */
  _gizmoMesh?: TransformNode;
  _rootMesh?: TransformNode;
  coloredMaterial: StandardMaterial;
  hoverMaterial: StandardMaterial;
};

function paintMaterial(
  mat: StandardMaterial,
  color: Color3,
  hover = false,
): void {
  const c = hover ? Color3.Lerp(color, Color3.White(), 0.35) : color;
  mat.diffuseColor = c.clone();
  mat.emissiveColor = c.scale(0.85);
  mat.specularColor = Color3.Black();
}

/**
 * Orient `mesh` so `localAxis` (unit-ish, in mesh local space) aligns with
 * `worldAxis`. Uses a stable reference up for Z-up worlds.
 */
function alignLocalAxisToWorld(
  mesh: TransformNode,
  localAxis: Vector3,
  worldAxis: Vector3,
): void {
  const target = worldAxis.normalizeToNew();
  const local = localAxis.normalizeToNew();
  // Prefer world +Z as the "up" hint; when aligning to ±Z use +Y instead.
  const refUp =
    Math.abs(Vector3.Dot(target, WORLD_Z)) > 0.95
      ? WORLD_Y.clone()
      : WORLD_Z.clone();

  // Build a rotation that maps `local` → `target`.
  const q = new Quaternion();
  // FromUnitVectorsToRef is unstable near 180°; handle anti-parallel explicitly.
  const dot = Vector3.Dot(local, target);
  if (dot > 0.999999) {
    q.copyFromFloats(0, 0, 0, 1);
  } else if (dot < -0.999999) {
    // 180° about any axis orthogonal to local
    const ortho =
      Math.abs(local.x) < 0.9
        ? Vector3.Cross(local, WORLD_X).normalize()
        : Vector3.Cross(local, WORLD_Y).normalize();
    Quaternion.RotationAxisToRef(ortho, Math.PI, q);
  } else {
    Quaternion.FromUnitVectorsToRef(local, target, q);
  }

  // Twist so a secondary axis stays near refUp (keeps rings from spinning flat).
  // Optional: skip if FromUnitVectors already ok — rings are circular so twist
  // is invisible; arrows are rotationally symmetric enough.
  void refUp;

  mesh.rotation.set(0, 0, 0);
  mesh.rotationQuaternion = q;
}

function hostMesh(gizmo: GizmoMeshHost): TransformNode | null {
  return gizmo._gizmoMesh ?? null;
}

/**
 * Paint + re-orient a {@link RotationGizmo} so ring color and ring normal both
 * match the corner axis helper (red↔X, green↔Y, blue↔Z).
 */
export function bindRotationGizmoToWorldAxes(gizmo: RotationGizmo): void {
  const axes: Array<{ g: GizmoMeshHost; axis: Vector3; color: Color3 }> = [
    {
      g: gizmo.xGizmo as unknown as GizmoMeshHost,
      axis: WORLD_X,
      color: WORLD_AXIS_COLORS.x,
    },
    {
      g: gizmo.yGizmo as unknown as GizmoMeshHost,
      axis: WORLD_Y,
      color: WORLD_AXIS_COLORS.y,
    },
    {
      g: gizmo.zGizmo as unknown as GizmoMeshHost,
      axis: WORLD_Z,
      color: WORLD_AXIS_COLORS.z,
    },
  ];
  for (const { g, axis, color } of axes) {
    paintMaterial(g.coloredMaterial, color);
    paintMaterial(g.hoverMaterial, color, true);
    const mesh = hostMesh(g);
    if (mesh) alignLocalAxisToWorld(mesh, TORUS_LOCAL_NORMAL, axis);
  }
}

/**
 * Paint + re-orient a {@link PositionGizmo} so arrow color and arrow direction
 * both match the corner axis helper.
 */
export function bindPositionGizmoToWorldAxes(gizmo: PositionGizmo): void {
  const axes: Array<{ g: GizmoMeshHost; axis: Vector3; color: Color3 }> = [
    {
      g: gizmo.xGizmo as unknown as GizmoMeshHost,
      axis: WORLD_X,
      color: WORLD_AXIS_COLORS.x,
    },
    {
      g: gizmo.yGizmo as unknown as GizmoMeshHost,
      axis: WORLD_Y,
      color: WORLD_AXIS_COLORS.y,
    },
    {
      g: gizmo.zGizmo as unknown as GizmoMeshHost,
      axis: WORLD_Z,
      color: WORLD_AXIS_COLORS.z,
    },
  ];
  for (const { g, axis, color } of axes) {
    paintMaterial(g.coloredMaterial, color);
    paintMaterial(g.hoverMaterial, color, true);
    const mesh = hostMesh(g);
    if (mesh) alignLocalAxisToWorld(mesh, ARROW_LOCAL_FORWARD, axis);
  }

  // Plane pads: color by the axis they are normal to (Babylon convention).
  const planes: Array<{ g: GizmoMeshHost; color: Color3 }> = [
    {
      g: gizmo.xPlaneGizmo as unknown as GizmoMeshHost,
      color: WORLD_AXIS_COLORS.x,
    },
    {
      g: gizmo.yPlaneGizmo as unknown as GizmoMeshHost,
      color: WORLD_AXIS_COLORS.y,
    },
    {
      g: gizmo.zPlaneGizmo as unknown as GizmoMeshHost,
      color: WORLD_AXIS_COLORS.z,
    },
  ];
  for (const { g, color } of planes) {
    paintMaterial(g.coloredMaterial, color);
    paintMaterial(g.hoverMaterial, color, true);
  }
}
