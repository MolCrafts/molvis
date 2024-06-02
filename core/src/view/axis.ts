import { Scene, MeshBuilder, StandardMaterial, DynamicTexture, Vector3, ArcRotateCamera, Viewport, Color3, HemisphericLight } from "@babylonjs/core";
import { AxesViewer as _AxesView } from "@babylonjs/core/Debug/axesViewer";
import { World, IRenderable } from "./world";

// https://playground.babylonjs.com/#QXHNNN#30
// https://www.babylonjs-playground.com/#U5NVC3#12

class Axes {

    private scene: Scene;
    private axes: _AxesView;

    constructor(scene: Scene, size: number) {

        this.scene = scene;
        this.axes = new _AxesView(scene, size);
        let font_size = size * 0.2;
        let x_end = this.axes.xAxis.position.clone();
        let y_end = this.axes.yAxis.position.clone();
        let z_end = this.axes.zAxis.position.clone();
        x_end.x += 0.4;
        y_end.y += 0.4;
        z_end.z += 0.4;
        let xChar = this._make_axis_label("X", "red", font_size, x_end);
        let yChar = this._make_axis_label("Y", "green", font_size, y_end);
        let zChar = this._make_axis_label("Z", "blue", font_size, z_end);    

        // Rotation
        xChar.rotation.x = Math.PI;
        yChar.rotation.x = Math.PI;
        zChar.rotation.z = Math.PI;

        // Parent
        xChar.parent = this.axes.xAxis;
        yChar.parent = this.axes.yAxis;
        zChar.parent = this.axes.zAxis;;
    }

    private _make_axis_label(text: string, color: string, size: number, position: Vector3) {
        let dynamicTexture = new DynamicTexture("DynamicTexture", 50, this.scene);
        dynamicTexture.hasAlpha = true;
        dynamicTexture.drawText(text, 5, 40, "bold 36px Arial", color, "transparent", false);
        let plane = MeshBuilder.CreatePlane("TextPlane", { size: size }, this.scene);
        let material = new StandardMaterial("TextPlaneMaterial", this.scene);
        material.backFaceCulling = false;
        material.specularColor = new Color3(0, 0, 0);
        material.diffuseTexture = dynamicTexture;
        plane.material = material;
        // plan parallel to camera
        plane.billboardMode = 7;
        plane.position = position;
        return plane;
    };

}

class AxesViewer implements IRenderable {


    private second_scene: Scene;
    private axes: Axes;

    constructor(world: World) {

        this.second_scene = new Scene(world.engine);
        this.second_scene.useRightHandedSystem = true;
        this.second_scene.autoClear = false;
        const cameraGizmo = new ArcRotateCamera("axes_camera", 2.0, Math.PI / 2, 5, Vector3.Zero(), this.second_scene);
        cameraGizmo.viewport = new Viewport(0.0, 0.0, 0.2, 0.2);

        // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.second_scene);
        // Default intensity is 1. Let's dim the light a small amount
        light.intensity = 1;

        light.diffuse = new Color3(1, 1, 1); // 漫射光颜色
        light.specular = new Color3(0.5, 0.5, 0.5); // 镜面光颜色
        light.groundColor = new Color3(0.8, 0.8, 0.8); // 地面光颜色

        this.axes = new Axes(this.second_scene, 0.8);

        // Clone main camera alpha and beta to axis camera
        world.scene.registerBeforeRender(() => {
            cameraGizmo.alpha = world.camera.alpha;
            cameraGizmo.beta = world.camera.beta;
        });

    }

    public render(scene: Scene) {
        this.second_scene.render();
    }
}

export { AxesViewer };