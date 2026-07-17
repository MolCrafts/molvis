import { ArcRotateCamera, NullEngine, Scene, Vector3 } from "@babylonjs/core";
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

  it("rotates only the Z label 180 degrees around its local Z axis", () => {
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
    const helper = new AxisHelper(engine, camera);

    try {
      const gizmoScene = engine.scenes.find((candidate) => candidate !== scene);
      expect(gizmoScene?.getMeshByName("axisLabelX")?.rotation.z).toBe(0);
      expect(gizmoScene?.getMeshByName("axisLabelY")?.rotation.z).toBe(0);
      expect(gizmoScene?.getMeshByName("axisLabelZ")?.rotation.z).toBeCloseTo(
        Math.PI,
        6,
      );
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
