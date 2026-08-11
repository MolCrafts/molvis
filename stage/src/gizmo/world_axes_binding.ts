/**
 * Force Babylon Position/Rotation gizmo visuals onto the MolVis world axes
 * (+X red, +Y green, +Z blue — same triad as {@link WORLD_AXES} / axis helper).
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
 *
 * Binding is required **once per gizmo construction only**: Babylon's
 * `lookAt` misalignment happens in the sub-gizmo constructor, and the
 * per-frame `Gizmo._update()` only rewrites the *root* mesh pose — the
 * `_gizmoMesh` child we re-orient here is never touched again (verified
 * against @babylonjs/core 9.13). Re-binding on attach is cheap insurance;
 * re-binding per frame is waste.
 */

import type {
  Color3,
  PositionGizmo,
  RotationGizmo,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import {
  alignLocalAxisToWorld,
  paintAxisMaterial,
  WORLD_AXES,
} from "./world_axes";

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
  coloredMaterial: StandardMaterial;
  hoverMaterial: StandardMaterial;
};

/** Paint one sub-gizmo's idle + hover materials in its axis color. */
function paintHost(host: GizmoMeshHost, color: Color3): void {
  paintAxisMaterial(host.coloredMaterial, color);
  paintAxisMaterial(host.hoverMaterial, color, true);
}

/**
 * Paint the x/y/z sub-gizmos and align each `_gizmoMesh` so `localAxis`
 * lands on the matching world axis. Shared by rotation rings and
 * position arrows — only the local axis differs.
 */
function bindAxisSubGizmos(
  hosts: readonly [GizmoMeshHost, GizmoMeshHost, GizmoMeshHost],
  localAxis: Vector3,
): void {
  for (let i = 0; i < WORLD_AXES.length; i++) {
    const host = hosts[i];
    const axis = WORLD_AXES[i];
    paintHost(host, axis.color);
    if (host._gizmoMesh) {
      alignLocalAxisToWorld(host._gizmoMesh, localAxis, axis.direction);
    }
  }
}

/**
 * Paint + re-orient a {@link RotationGizmo} so ring color and ring normal both
 * match the corner axis helper (red↔X, green↔Y, blue↔Z).
 */
export function bindRotationGizmoToWorldAxes(gizmo: RotationGizmo): void {
  bindAxisSubGizmos(
    [
      gizmo.xGizmo as unknown as GizmoMeshHost,
      gizmo.yGizmo as unknown as GizmoMeshHost,
      gizmo.zGizmo as unknown as GizmoMeshHost,
    ],
    TORUS_LOCAL_NORMAL,
  );
}

/**
 * Paint + re-orient a {@link PositionGizmo} so arrow color and arrow direction
 * both match the corner axis helper. Plane pads are colored by the axis they
 * are normal to (Babylon convention).
 */
export function bindPositionGizmoToWorldAxes(gizmo: PositionGizmo): void {
  bindAxisSubGizmos(
    [
      gizmo.xGizmo as unknown as GizmoMeshHost,
      gizmo.yGizmo as unknown as GizmoMeshHost,
      gizmo.zGizmo as unknown as GizmoMeshHost,
    ],
    ARROW_LOCAL_FORWARD,
  );

  const planes: readonly [GizmoMeshHost, GizmoMeshHost, GizmoMeshHost] = [
    gizmo.xPlaneGizmo as unknown as GizmoMeshHost,
    gizmo.yPlaneGizmo as unknown as GizmoMeshHost,
    gizmo.zPlaneGizmo as unknown as GizmoMeshHost,
  ];
  for (let i = 0; i < WORLD_AXES.length; i++) {
    paintHost(planes[i], WORLD_AXES[i].color);
  }
}
