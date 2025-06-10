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
  const ray = scene.createPickingRay(
    x,
    y,
    Matrix.Identity(),
    scene.activeCamera,
  );
  const xyz = ray.origin.add(ray.direction.scale(depth));
  if (debug) {
    const rayHelper = new RayHelper(ray);
    rayHelper.show(scene, new Color3(1, 1, 0.5));
  }
  return xyz;
}
