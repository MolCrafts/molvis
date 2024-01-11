import * as BABYLON from "@babylonjs/core";
import { makeTextPlane } from "./gui";
// https://forum.babylonjs.com/t/camera-maintain-the-meshes-at-the-same-position-relative-to-screen-during-screen-resize/9320
// https://playground.babylonjs.com/#QXHNNN#30

class AxisHelper {

    private _scene: BABYLON.Scene;

    public constructor(engine: BABYLON.Engine, camera: BABYLON.ArcRotateCamera) {
        let scene = new BABYLON.Scene(engine);
        this._scene = scene;
        scene.autoClear = false;
        var cameraGizmo = new BABYLON.ArcRotateCamera("cam1", 2.0, Math.PI / 2, 5, BABYLON.Vector3.Zero(), scene);
        cameraGizmo.viewport = new BABYLON.Viewport(0.0, 0.0, 0.2, 0.2);
    
        // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
        var light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
        // Default intensity is 1. Let's dim the light a small amount
        light.intensity = 0.7;
    
        var lightGizmo = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
    
        let axis = new BABYLON.AxesViewer(scene, 1);
        
        // Clone main camera alpha and beta to axis camera
        scene.registerBeforeRender(function () {
            cameraGizmo.alpha = camera.alpha;
            cameraGizmo.beta = camera.beta;
        });
    
    }

    public render() {
        this._scene.render();
    }
}

export { AxisHelper };