import { NullEngine, Scene } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import {
  buildRegionLines,
  RegionWireframeOverlay,
  type RegionWireframeSpec,
} from "../src/overlays/region_wireframe";
import { SphereWireframeOverlay } from "../src/overlays/sphere_wireframe";

/**
 * RegionWireframeOverlay unit tests — one wireframe shape per molpack geometric
 * restraint family. A NullEngine scene gives the overlay a real BabylonJS scene
 * to build its LinesMesh into without touching the GPU; we assert the Overlay
 * contract and the polyline topology rather than pixels.
 */
function makeScene(): Scene {
  return new Scene(new NullEngine());
}

const SHAPES: RegionWireframeSpec[] = [
  { kind: "sphere", radius: 5 },
  { kind: "ellipsoid", radii: [4, 6, 3] },
  { kind: "box", min: [-1, -2, -3], max: [1, 2, 3] },
  { kind: "cylinder", axis: [0, 0, 1], radius: 3, length: 10 },
  { kind: "plane", normal: [0, 0, 1], distance: 2 },
  { kind: "gaussian", cx: 0, cy: 0, sx: 2, sy: 2, z0: 0, height: 5 },
];

describe("RegionWireframeOverlay", () => {
  for (const shape of SHAPES) {
    it(`builds a non-pickable mesh for kind "${shape.kind}" and disposes it`, () => {
      const scene = makeScene();
      const before = scene.meshes.length;
      const overlay = new RegionWireframeOverlay(
        `r-${shape.kind}`,
        shape,
        scene,
      );
      try {
        expect(overlay.type).toBe(`${shape.kind}_wireframe`);
        expect(overlay.visible).toBe(true);
        expect(scene.meshes.length).toBe(before + 1);
        expect(scene.meshes[scene.meshes.length - 1].isPickable).toBe(false);
      } finally {
        overlay.dispose();
        expect(scene.meshes.length).toBe(before);
        scene.dispose();
      }
    });
  }

  it("toggles visibility through the mesh enabled flag", () => {
    const scene = makeScene();
    const overlay = new RegionWireframeOverlay(
      "r",
      { kind: "sphere", radius: 1 },
      scene,
    );
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
});

describe("buildRegionLines topology", () => {
  it("box has exactly 12 edges, each a 2-point segment", () => {
    const lines = buildRegionLines({
      kind: "box",
      min: [0, 0, 0],
      max: [1, 1, 1],
    });
    expect(lines).toHaveLength(12);
    expect(lines.every((l) => l.length === 2)).toBe(true);
  });

  it("cylinder has two end circles plus the requested struts", () => {
    const lines = buildRegionLines({
      kind: "cylinder",
      axis: [0, 0, 1],
      radius: 2,
      length: 6,
      struts: 8,
    });
    expect(lines).toHaveLength(2 + 8);
  });

  it("sphere and ellipsoid share the lat/long net count", () => {
    const s = buildRegionLines({
      kind: "sphere",
      radius: 3,
      latitudes: 11,
      longitudes: 18,
    });
    const e = buildRegionLines({
      kind: "ellipsoid",
      radii: [3, 3, 3],
      latitudes: 11,
      longitudes: 18,
    });
    // (latitudes - 1) rings + longitudes meridians
    expect(s).toHaveLength(10 + 18);
    expect(e).toHaveLength(s.length);
  });
});

describe("SphereWireframeOverlay (back-compat)", () => {
  it("is a RegionWireframeOverlay with type sphere_wireframe", () => {
    const scene = makeScene();
    const overlay = new SphereWireframeOverlay("s", { radius: 4 }, scene);
    try {
      expect(overlay).toBeInstanceOf(RegionWireframeOverlay);
      expect(overlay.type).toBe("sphere_wireframe");
    } finally {
      overlay.dispose();
      scene.dispose();
    }
  });
});
