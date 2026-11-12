/**
 * SurfaceMeshRenderer tests.
 *
 * A NullEngine scene gives the renderer a real BabylonJS scene without
 * touching the GPU; the assertions are on mesh topology and lifecycle
 * rather than pixels.
 */

import { NullEngine, Scene } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import type { SurfaceMesh } from "../../../src/algo/surface_mesh";
import {
  DEFAULT_SURFACE_DRAW_STYLE,
  type SurfaceDrawStyle,
  SurfaceMeshRenderer,
} from "../../../src/artist/surface/surface_mesh_renderer";

const STYLE: SurfaceDrawStyle = {
  ...DEFAULT_SURFACE_DRAW_STYLE,
  color: [1, 0, 0],
  opacity: 1,
  finish: "solid",
  contourSpacing: 0.45,
};

/** Two triangles sharing an edge — four unique source vertices. */
function quad(): SurfaceMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

const EMPTY: SurfaceMesh = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  indices: new Uint32Array(0),
};

function makeScene(): Scene {
  return new Scene(new NullEngine());
}

describe("SurfaceMeshRenderer", () => {
  it("installs a mesh and reports having data", () => {
    const scene = makeScene();
    const renderer = new SurfaceMeshRenderer(scene);
    expect(renderer.hasData).toBe(false);

    const mesh = renderer.add("surface", quad(), [1, 0, 0], STYLE);
    expect(mesh).not.toBeNull();
    expect(renderer.hasData).toBe(true);
    scene.dispose();
  });

  it("expands to one vertex per triangle corner for barycentric edges", () => {
    const scene = makeScene();
    const renderer = new SurfaceMeshRenderer(scene);
    const mesh = renderer.add("surface", quad(), [1, 0, 0], STYLE);

    // Two triangles × three corners, regardless of source vertex sharing.
    expect(mesh?.getTotalVertices()).toBe(6);
    expect(mesh?.getTotalIndices()).toBe(6);
    expect(mesh?.getVerticesData("barycentric")?.length).toBe(18);
    scene.dispose();
  });

  it("refuses empty geometry instead of installing a blank mesh", () => {
    const scene = makeScene();
    const renderer = new SurfaceMeshRenderer(scene);
    expect(renderer.add("surface", EMPTY, [1, 0, 0], STYLE)).toBeNull();
    expect(renderer.hasData).toBe(false);
    scene.dispose();
  });

  it("leaves the surface unpickable so clicks reach the atoms behind it", () => {
    const scene = makeScene();
    const renderer = new SurfaceMeshRenderer(scene);
    const mesh = renderer.add("surface", quad(), [1, 0, 0], STYLE);
    expect(mesh?.isPickable).toBe(false);
    scene.dispose();
  });

  it("toggles every installed mesh together", () => {
    const scene = makeScene();
    const renderer = new SurfaceMeshRenderer(scene);
    const a = renderer.add("a", quad(), [1, 0, 0], STYLE);
    const b = renderer.add("b", quad(), [0, 1, 0], STYLE);

    renderer.setVisible(false);
    expect(a?.isEnabled()).toBe(false);
    expect(b?.isEnabled()).toBe(false);
    renderer.setVisible(true);
    expect(a?.isEnabled()).toBe(true);
    expect(b?.isEnabled()).toBe(true);
    scene.dispose();
  });

  it("dispose removes the meshes from the scene", () => {
    const scene = makeScene();
    const renderer = new SurfaceMeshRenderer(scene);
    renderer.add("surface", quad(), [1, 0, 0], STYLE);
    const before = scene.meshes.length;

    renderer.dispose();
    expect(renderer.hasData).toBe(false);
    expect(scene.meshes.length).toBe(before - 1);
    scene.dispose();
  });

  it("translucent surfaces get the depth pre-pass, opaque ones do not", () => {
    // Without it the far side of a closed surface punches through the near
    // side; with it at full opacity it is wasted work.
    const scene = makeScene();
    const renderer = new SurfaceMeshRenderer(scene);
    const solid = renderer.add("solid", quad(), [1, 0, 0], STYLE);
    const glass = renderer.add("glass", quad(), [1, 0, 0], {
      ...STYLE,
      opacity: 0.5,
    });

    expect(solid?.material?.needDepthPrePass).toBe(false);
    expect(glass?.material?.needDepthPrePass).toBe(true);
    scene.dispose();
  });
});
