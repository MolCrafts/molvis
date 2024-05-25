import { Scene, MeshBuilder, StandardMaterial, DynamicTexture, Vector3, ArcRotateCamera, Viewport, Color3 } from "@babylonjs/core";
import { AxesViewer as _AxesView } from "@babylonjs/core/Debug/axesViewer";
import World from "./world";

// https://playground.babylonjs.com/#QXHNNN#30
// https://www.babylonjs-playground.com/#U5NVC3#12

class Axes {

    private scene: Scene;
    private axes: _AxesView;

    constructor(scene: Scene, size: number) {

        this.scene = scene;
        this.axes = new _AxesView(scene, size);
        let font_size = size * 0.2;
        let xChar = this._make_axis_label("X", "red", font_size);
        let yChar = this._make_axis_label("Y", "green", font_size);
        let zChar = this._make_axis_label("Z", "blue", font_size);

        // Position
        xChar.position = this.axes.xAxis.position.clone();
        yChar.position = this.axes.yAxis.position.clone();
        zChar.position = this.axes.zAxis.position.clone();
        xChar.position.z += 0.4;
        yChar.position.z += 0.4;
        zChar.position.z += 0.4;

        // Rotation
        // xChar.rotation.y = Math.PI/2;
        yChar.rotation.x = Math.PI / 2;
        // zChar.rotation.z = Math.PI/2;

        // Parent
        xChar.parent = this.axes.xAxis;
        yChar.parent = this.axes.yAxis;
        zChar.parent = this.axes.zAxis;;
    }

    private _make_axis_label(text: string, color: string, size: number) {
        var dynamicTexture = new DynamicTexture("DynamicTexture", 50, this.scene, true);
        dynamicTexture.hasAlpha = true;
        dynamicTexture.drawText(text, 5, 40, "bold 36px Arial", color, "transparent", true);
        var plane = MeshBuilder.CreatePlane("TextPlane", { size: size }, this.scene);
        let material = new StandardMaterial("TextPlaneMaterial", this.scene);
        material.backFaceCulling = false;
        material.specularColor = new Color3(0, 0, 0);
        material.diffuseTexture = dynamicTexture;
        plane.material = material;
        return plane;
    };

}

class AxesViewer {


    private second_scene: Scene;
    private axes: Axes;

    constructor(world: World) {

        this.second_scene = new Scene(world.engine);
        this.second_scene.useRightHandedSystem = true;
        this.second_scene.autoClear = false;
        const cameraGizmo = new ArcRotateCamera("axes_camera", 2.0, Math.PI / 2, 5, Vector3.Zero(), this.second_scene);
        cameraGizmo.viewport = new Viewport(0.0, 0.0, 0.2, 0.2);

        // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
        // var light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
        // // Default intensity is 1. Let's dim the light a small amount
        // light.intensity = 0.7;

        // var lightGizmo = new HemisphericLight("light", new Vector3(0, 1, 0), scene);

        this.axes = new Axes(this.second_scene, 0.8);

        // Clone main camera alpha and beta to axis camera
        world.scene.registerBeforeRender(function () {
            cameraGizmo.alpha = world.camera.alpha;
            cameraGizmo.beta = world.camera.beta;
        });

    }

    public render(scene: Scene) {
        this.second_scene.render();
    }
}

export { AxesViewer };