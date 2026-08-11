import {
  ArcRotateCamera,
  NullEngine,
  PositionGizmo,
  RotationGizmo,
  Scene,
  type StandardMaterial,
  type TransformNode,
  UtilityLayerRenderer,
  Vector3,
} from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { WORLD_AXES } from "../../src/gizmo/world_axes";
import {
  bindPositionGizmoToWorldAxes,
  bindRotationGizmoToWorldAxes,
} from "../../src/gizmo/world_axes_binding";

/** Runtime shape of Babylon's per-axis sub-gizmos (private but present). */
type GizmoMeshHost = {
  _gizmoMesh?: TransformNode;
  coloredMaterial: StandardMaterial;
};

function setup(): {
  scene: Scene;
  layer: UtilityLayerRenderer;
  disposeAll: () => void;
} {
  const engine = new NullEngine({
    renderWidth: 256,
    renderHeight: 256,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine);
  // Match the main World scene: right-handed + Z-up — the exact setup under
  // which Babylon's lookAt-based gizmo orientation goes wrong.
  scene.useRightHandedSystem = true;
  const camera = new ArcRotateCamera(
    "cam",
    Math.PI / 4,
    Math.PI / 3,
    10,
    Vector3.Zero(),
    scene,
  );
  camera.upVector = new Vector3(0, 0, 1);
  scene.activeCamera = camera;
  const layer = new UtilityLayerRenderer(scene);
  return {
    scene,
    layer,
    disposeAll: () => {
      layer.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

/** World direction of `localAxis` under the sub-gizmo's `_gizmoMesh` pose. */
function gizmoMeshWorldAxis(host: GizmoMeshHost, localAxis: Vector3): Vector3 {
  const mesh = host._gizmoMesh;
  expect(mesh).toBeTruthy();
  expect(mesh?.rotationQuaternion).toBeTruthy();
  return localAxis.applyRotationQuaternion(mesh!.rotationQuaternion!);
}

describe("bindRotationGizmoToWorldAxes", () => {
  it("puts each ring normal on its world axis with the shared color", () => {
    const { layer, disposeAll } = setup();
    const gizmo = new RotationGizmo(layer, 32, false, 1.25);
    try {
      bindRotationGizmoToWorldAxes(gizmo);
      const hosts = [
        gizmo.xGizmo,
        gizmo.yGizmo,
        gizmo.zGizmo,
      ] as unknown as GizmoMeshHost[];
      // Babylon's torus hole sits on local −Y of _gizmoMesh (see binding).
      const torusNormal = new Vector3(0, -1, 0);
      for (let i = 0; i < WORLD_AXES.length; i++) {
        const axis = WORLD_AXES[i];
        const normal = gizmoMeshWorldAxis(hosts[i], torusNormal);
        expect(normal.x).toBeCloseTo(axis.direction.x, 5);
        expect(normal.y).toBeCloseTo(axis.direction.y, 5);
        expect(normal.z).toBeCloseTo(axis.direction.z, 5);
        expect(
          hosts[i].coloredMaterial.diffuseColor.equalsFloats(
            axis.color.r,
            axis.color.g,
            axis.color.b,
          ),
        ).toBe(true);
      }
    } finally {
      gizmo.dispose();
      disposeAll();
    }
  });
});

describe("bindPositionGizmoToWorldAxes", () => {
  it("points each arrow along its world axis with the shared color", () => {
    const { layer, disposeAll } = setup();
    const gizmo = new PositionGizmo(layer, 1.25);
    try {
      bindPositionGizmoToWorldAxes(gizmo);
      const hosts = [
        gizmo.xGizmo,
        gizmo.yGizmo,
        gizmo.zGizmo,
      ] as unknown as GizmoMeshHost[];
      // AxisDragGizmo arrows point along local +Z of _gizmoMesh.
      const arrowForward = new Vector3(0, 0, 1);
      for (let i = 0; i < WORLD_AXES.length; i++) {
        const axis = WORLD_AXES[i];
        const forward = gizmoMeshWorldAxis(hosts[i], arrowForward);
        expect(forward.x).toBeCloseTo(axis.direction.x, 5);
        expect(forward.y).toBeCloseTo(axis.direction.y, 5);
        expect(forward.z).toBeCloseTo(axis.direction.z, 5);
        expect(
          hosts[i].coloredMaterial.diffuseColor.equalsFloats(
            axis.color.r,
            axis.color.g,
            axis.color.b,
          ),
        ).toBe(true);
      }
    } finally {
      gizmo.dispose();
      disposeAll();
    }
  });

  it("colors the plane pads by the axis they are normal to", () => {
    const { layer, disposeAll } = setup();
    const gizmo = new PositionGizmo(layer, 1.25);
    try {
      bindPositionGizmoToWorldAxes(gizmo);
      const planes = [
        gizmo.xPlaneGizmo,
        gizmo.yPlaneGizmo,
        gizmo.zPlaneGizmo,
      ] as unknown as GizmoMeshHost[];
      for (let i = 0; i < WORLD_AXES.length; i++) {
        const axis = WORLD_AXES[i];
        expect(
          planes[i].coloredMaterial.diffuseColor.equalsFloats(
            axis.color.r,
            axis.color.g,
            axis.color.b,
          ),
        ).toBe(true);
      }
    } finally {
      gizmo.dispose();
      disposeAll();
    }
  });
});
