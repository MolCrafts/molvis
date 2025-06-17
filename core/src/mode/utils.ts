import {
  AbstractMesh,
  Color3,
  Matrix,
  RayHelper,
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
  depth: number,
  debug = false,
): Vector3 {
  let canvasX = x;
  let canvasY = y;
  const canvas = scene.getEngine().getRenderingCanvas();
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvasX = (x - rect.left) * dpr;
    canvasY = (y - rect.top) * dpr;
  }
  const ray = scene.createPickingRay(
    canvasX,
    canvasY,
    Matrix.Identity(),
    scene.activeCamera,
  );
  const xyz = ray.origin.add(ray.direction.scale(depth));
  if (debug) {
    // eslint-disable-next-line no-console
    console.log('[get_vec3_from_screen_with_depth] input:', {x, y, canvasX, canvasY, depth});
    // eslint-disable-next-line no-console
    console.log('[get_vec3_from_screen_with_depth] ray:', ray.origin, ray.direction);
    // eslint-disable-next-line no-console
    console.log('[get_vec3_from_screen_with_depth] result xyz:', xyz);
    // eslint-disable-next-line no-console
    if (scene.activeCamera) {
      console.log('[get_vec3_from_screen_with_depth] camera:', scene.activeCamera.position, scene.activeCamera.getTarget());
    }
  }
  return xyz;
}