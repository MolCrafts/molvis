import {
  AbstractMesh,
  Matrix,
  Scene,
  Vector3,
} from "@babylonjs/core";

export function highlight_mesh(mesh: AbstractMesh) {
  mesh.renderOutline = !mesh.renderOutline;
}

export function get_vec3_from_screen_with_depth(
  scene: Scene,
  x: number,
  y: number,
  depth: number
): Vector3 {
  // Convert screen coordinates to canvas-relative coordinates
  let canvasX = x;
  let canvasY = y;
  const canvas = scene.getEngine().getRenderingCanvas();
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    canvasX = x - rect.left;
    canvasY = y - rect.top;
  }

  const ray = scene.createPickingRay(
    canvasX,
    canvasY,
    Matrix.Identity(),
    scene.activeCamera,
  );
  const xyz = ray.origin.add(ray.direction.scale(depth));
  return xyz;
}