import { NullEngine, Scene } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { SphereWireframeOverlay } from "../src/overlays/sphere_wireframe";

/**
 * SphereWireframeOverlay unit tests.
 *
 * A NullEngine scene gives the overlay a real BabylonJS scene to build its
 * LinesMesh into without touching the GPU. We assert the Overlay contract
 * (id/type/visible/dispose) rather than pixels.
 */
function makeScene(): Scene {
  return new Scene(new NullEngine());
}

describe("SphereWireframeOverlay", () => {
  it("exposes the Overlay contract", () => {
    const scene = makeScene();
    const overlay = new SphereWireframeOverlay(
      "shell",
      { radius: 5, center: [1, 2, 3] },
      scene,
    );
    try {
      expect(overlay.id).toBe("shell");
      expect(overlay.type).toBe("sphere_wireframe");
      expect(overlay.visible).toBe(true);
    } finally {
      overlay.dispose();
      scene.dispose();
    }
  });

  it("toggles visibility through the mesh enabled flag", () => {
    const scene = makeScene();
    const overlay = new SphereWireframeOverlay("shell", { radius: 3 }, scene);
    try {
      overlay.visible = false;
      expect(overlay.visible).toBe(false);
      overlay.visible = true;
      expect(overlay.visible).toBe(true);
    } finally {
      overlay.dispose();
      scene.dispose();
    }
  });

  it("builds a non-pickable line mesh and removes it on dispose", () => {
    const scene = makeScene();
    const before = scene.meshes.length;
    const overlay = new SphereWireframeOverlay(
      "shell",
      { radius: 4, latitudes: 6, longitudes: 8 },
      scene,
    );
    expect(scene.meshes.length).toBe(before + 1);
    const mesh = scene.meshes[scene.meshes.length - 1];
    expect(mesh.isPickable).toBe(false);

    overlay.dispose();
    expect(scene.meshes.length).toBe(before);
    scene.dispose();
  });

  it("accepts default styling without throwing", () => {
    const scene = makeScene();
    expect(
      () => new SphereWireframeOverlay("s", { radius: 1 }, scene),
    ).not.toThrow();
    scene.dispose();
  });
});
