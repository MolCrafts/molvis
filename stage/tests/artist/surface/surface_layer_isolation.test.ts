/**
 * Two surface draws in one pipeline must not overwrite each other's mesh.
 *
 * The renderer used to be a single artist-wide instance with fixed mesh
 * names, so adding a molecular surface next to a CUBE file's isosurface
 * silently erased the first. Each draw step now owns its own renderer, keyed
 * by modifier id; this pins that.
 */

import { NullEngine, Scene } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import type { SurfaceMesh } from "../../../src/algo/surface_mesh";
import {
  DEFAULT_SURFACE_DRAW_STYLE,
  SurfaceMeshRenderer,
} from "../../../src/artist/surface/surface_mesh_renderer";

function triangle(): SurfaceMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

/** Both opaque to start, so a later opacity change is unambiguous. */
const OPAQUE = { ...DEFAULT_SURFACE_DRAW_STYLE, opacity: 1 };

function twoLayers(scene: Scene): [SurfaceMeshRenderer, SurfaceMeshRenderer] {
  const alpha = new SurfaceMeshRenderer(scene);
  const bravo = new SurfaceMeshRenderer(scene);
  alpha.add("surface#Alpha", triangle(), [1, 0, 0], OPAQUE);
  bravo.add("surface#Bravo", triangle(), [0, 1, 0], OPAQUE);
  return [alpha, bravo];
}

describe("surface layer isolation", () => {
  it("two owners keep separate meshes in one scene", () => {
    const scene = new Scene(new NullEngine());
    const [alpha, bravo] = twoLayers(scene);

    expect(alpha.hasData).toBe(true);
    expect(bravo.hasData).toBe(true);
    const names = scene.meshes.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    scene.dispose();
  });

  it("disposing one owner leaves the other drawn", () => {
    const scene = new Scene(new NullEngine());
    const [alpha, bravo] = twoLayers(scene);

    alpha.dispose();
    expect(alpha.hasData).toBe(false);
    expect(bravo.hasData).toBe(true);
    scene.dispose();
  });

  it("hiding one owner does not hide the other", () => {
    const scene = new Scene(new NullEngine());
    const [alpha] = twoLayers(scene);

    alpha.setVisible(false);
    expect(scene.meshes.filter((m) => m.isEnabled()).length).toBe(1);
    scene.dispose();
  });

  it("restyling one owner does not touch the other", () => {
    // Colour and opacity are per-draw; two surfaces in one scene have to be
    // tellable apart.
    const scene = new Scene(new NullEngine());
    const [alpha] = twoLayers(scene);

    alpha.setOpacity(0.2);
    const [alphaMesh, bravoMesh] = scene.meshes;
    expect(alphaMesh.material?.needDepthPrePass).toBe(true);
    expect(bravoMesh.material?.needDepthPrePass).toBe(false);
    scene.dispose();
  });
});
