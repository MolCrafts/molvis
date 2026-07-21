import {
  ArcRotateCamera,
  NullEngine,
  Quaternion,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { AxisHelper, axisHelperViewport } from "../src/axis_helper";

describe("AxisHelper", () => {
  it("scales its square viewport with the canvas and includes the 20% enlargement", () => {
    const viewport = axisHelperViewport(1200, 800);
    const doubled = axisHelperViewport(2400, 1600);

    expect(viewport.width * 1200).toBeCloseTo(144, 6);
    expect(viewport.height * 800).toBeCloseTo(144, 6);
    expect(doubled.width * 2400).toBeCloseTo(288, 6);
    expect(doubled.height * 1600).toBeCloseTo(288, 6);
    expect(doubled.x * 2400).toBeCloseTo(viewport.x * 1200 * 2, 6);
    expect(doubled.y * 1600).toBeCloseTo(viewport.y * 800 * 2, 6);
  });

  it("uses manual orientation with RH un-mirror (scaling.x = -1), no billboard", () => {
    const engine = new NullEngine({ renderWidth: 1200, renderHeight: 800 });
    const scene = new Scene(engine);
    const camera = new ArcRotateCamera(
      "camera",
      Math.PI / 4,
      Math.PI / 3,
      10,
      Vector3.Zero(),
      scene,
    );
    camera.upVector = new Vector3(0, 0, 1);
    const helper = new AxisHelper(engine, camera);

    try {
      const gizmoScene = engine.scenes.find((candidate) => candidate !== scene);
      for (const name of ["axisLabelX", "axisLabelY", "axisLabelZ"]) {
        const mesh = gizmoScene?.getMeshByName(name);
        expect(mesh).toBeTruthy();
        // BILLBOARDMODE_NONE === 0 — manual orientation avoids the Z-up singularity.
        expect(mesh?.billboardMode ?? 0).toBe(0);
        // RH front-face view mirrors local +X; flip so Z diagonal is \ not /.
        expect(mesh?.scaling.x).toBeCloseTo(-1, 6);
        expect(mesh?.scaling.y).toBeCloseTo(1, 6);
        expect(mesh?.rotationQuaternion).toBeTruthy();
      }
    } finally {
      helper.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("places axis tips along +X, +Y, +Z (right-handed Z-up)", () => {
    const engine = new NullEngine({ renderWidth: 1200, renderHeight: 800 });
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const camera = new ArcRotateCamera(
      "camera",
      Math.PI / 4,
      Math.acos(1 / Math.sqrt(3)),
      10,
      Vector3.Zero(),
      scene,
    );
    camera.upVector = new Vector3(0, 0, 1);
    const helper = new AxisHelper(engine, camera);

    try {
      const gizmoScene = engine.scenes.find((candidate) => candidate !== scene);
      expect(gizmoScene).toBeTruthy();

      // Labels sit just past the arrow tip along each world axis.
      // AxisViewer size = 2.5, label offset = size + 0.35 = 2.85.
      const tip = 2.85;
      const labelX = gizmoScene!.getMeshByName("axisLabelX")!;
      const labelY = gizmoScene!.getMeshByName("axisLabelY")!;
      const labelZ = gizmoScene!.getMeshByName("axisLabelZ")!;

      expect(labelX.position.x).toBeCloseTo(tip, 5);
      expect(labelX.position.y).toBeCloseTo(0, 5);
      expect(labelX.position.z).toBeCloseTo(0, 5);

      expect(labelY.position.x).toBeCloseTo(0, 5);
      expect(labelY.position.y).toBeCloseTo(tip, 5);
      expect(labelY.position.z).toBeCloseTo(0, 5);

      // Z must point to +Z — this is the invariant that kept regressing.
      expect(labelZ.position.x).toBeCloseTo(0, 5);
      expect(labelZ.position.y).toBeCloseTo(0, 5);
      expect(labelZ.position.z).toBeCloseTo(tip, 5);

      // Pivot quaternions must map local +Y onto each world axis.
      for (const [name, expected] of [
        ["pivotX", new Vector3(1, 0, 0)],
        ["pivotY", new Vector3(0, 1, 0)],
        ["pivotZ", new Vector3(0, 0, 1)],
      ] as const) {
        const pivot = gizmoScene!.getMeshByName(name)!;
        expect(pivot).toBeTruthy();
        const q =
          pivot.rotationQuaternion ??
          Quaternion.FromEulerVector(pivot.rotation);
        const worldDir = new Vector3(0, 1, 0).applyRotationQuaternion(q);
        expect(worldDir.x).toBeCloseTo(expected.x, 5);
        expect(worldDir.y).toBeCloseTo(expected.y, 5);
        expect(worldDir.z).toBeCloseTo(expected.z, 5);
      }
    } finally {
      helper.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("updates the viewport when the render canvas is resized", () => {
    const engine = new NullEngine({ renderWidth: 1200, renderHeight: 800 });
    const renderSize = { width: 1200, height: 800 };
    engine.getRenderWidth = () => renderSize.width;
    engine.getRenderHeight = () => renderSize.height;
    const scene = new Scene(engine);
    const camera = new ArcRotateCamera(
      "camera",
      Math.PI / 4,
      Math.PI / 3,
      10,
      Vector3.Zero(),
      scene,
    );
    camera.upVector = new Vector3(0, 0, 1);
    const helper = new AxisHelper(engine, camera);

    try {
      const gizmoScene = engine.scenes.find((candidate) => candidate !== scene);
      const gizmoCamera = gizmoScene?.activeCamera;
      expect(gizmoCamera?.viewport.width).toBeCloseTo(144 / 1200, 6);

      renderSize.width = 2400;
      engine.onResizeObservable.notifyObservers(engine);

      expect(gizmoCamera?.viewport.width).toBeCloseTo(144 / 2400, 6);
      expect(gizmoCamera?.viewport.height).toBeCloseTo(144 / 800, 6);
    } finally {
      helper.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});
