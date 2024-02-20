import * as BABYLON from "@babylonjs/core";


function pick_screen_with_depth(scene: BABYLON.Scene, depth:number): BABYLON.Vector3 {
    const x = scene.pointerX;
    const y = scene.pointerY;
    const ray = scene.createPickingRay(x, y, BABYLON.Matrix.Identity(), scene.activeCamera);
    // var rayHelper = new BABYLON.RayHelper(ray);
    // rayHelper.show(scene, new BABYLON.Color3(1, 1, 0.5));
    const xyz = ray.origin.add(ray.direction.scale(10));
    return xyz;
}

export {pick_screen_with_depth};