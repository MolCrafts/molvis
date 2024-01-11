import * as BABYLON from "@babylonjs/core";
// https://forum.babylonjs.com/t/camera-maintain-the-meshes-at-the-same-position-relative-to-screen-during-screen-resize/9320
// https://playground.babylonjs.com/#QXHNNN#30
// https://www.babylonjs-playground.com/#U5NVC3#12

class AxisViewer {

    private _scene: BABYLON.Scene;
    private _axis: BABYLON.AxesViewer;

    constructor(scene: BABYLON.Scene, size: number) {

        this._scene = scene;
        this._axis = new BABYLON.AxesViewer(scene, size);
        let font_size = size * 0.2;
        let xChar = this._make_axis_label("X", "red", font_size);
        let yChar = this._make_axis_label("Y", "green", font_size);
        let zChar = this._make_axis_label("Z", "blue", font_size);
        // Position
        xChar.position = this._axis.xAxis.position.clone();
        yChar.position = this._axis.yAxis.position.clone();
        zChar.position = this._axis.zAxis.position.clone();
        xChar.position.z += 0.4;
        yChar.position.z += 0.4;
        zChar.position.z += 0.4;

        // Rotation
        // xChar.rotation.y = Math.PI/2;
        yChar.rotation.x = Math.PI/2;
        // zChar.rotation.z = Math.PI/2;

        // Parent
        xChar.parent = this._axis.xAxis;
        yChar.parent = this._axis.yAxis;
        zChar.parent = this._axis.zAxis;; 
    }

    private _make_axis_label(text:string, color:string, size:number) {
        var dynamicTexture = new BABYLON.DynamicTexture("DynamicTexture", 50, this._scene, true);
        dynamicTexture.hasAlpha = true;
        dynamicTexture.drawText(text, 5, 40, "bold 36px Arial", color , "transparent", true);
        var plane = BABYLON.MeshBuilder.CreatePlane("TextPlane", {size:size}, this._scene);
        let material = new BABYLON.StandardMaterial("TextPlaneMaterial", this._scene);
        material.backFaceCulling = false;
        material.specularColor = new BABYLON.Color3(0, 0, 0);
        material.diffuseTexture = dynamicTexture;
        plane.material = material;
        return plane;
        };

}

class AxisHelper {

    private _scene: BABYLON.Scene;

    public constructor(engine: BABYLON.Engine, camera: BABYLON.ArcRotateCamera) {
        let scene = new BABYLON.Scene(engine);
        this._scene = scene;
        scene.useRightHandedSystem = true;
        scene.autoClear = false;
        var cameraGizmo = new BABYLON.ArcRotateCamera("cam1", 2.0, Math.PI / 2, 5, BABYLON.Vector3.Zero(), scene);
        cameraGizmo.viewport = new BABYLON.Viewport(0.0, 0.0, 0.2, 0.2);
    
        // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
        // var light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
        // // Default intensity is 1. Let's dim the light a small amount
        // light.intensity = 0.7;
    
        // var lightGizmo = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
    
        let axis = new AxisViewer(scene, 1);
        
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