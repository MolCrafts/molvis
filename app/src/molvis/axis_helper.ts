import * as BABYLON from "@babylonjs/core";
// https://forum.babylonjs.com/t/camera-maintain-the-meshes-at-the-same-position-relative-to-screen-during-screen-resize/9320
// https://playground.babylonjs.com/#QXHNNN#30

class AxisHelper {

    private _axis: BABYLON.AxesViewer;
    private _scene: BABYLON.Scene;
    private _camera: BABYLON.Camera;

    public constructor(scene: BABYLON.Scene, camera: BABYLON.Camera) {
        this._scene = scene;
        this._camera = camera;
        this._axis = this._create_axis_helper(1);
    }

    private _create_axis_helper(size: number) {
        const scene = this._scene;
        const camera = this._camera;
        const axis = new BABYLON.AxesViewer(scene, size);

        // Text Plane
        let makeTextPlane = function (text: string, color: string, size: number) {
            let dynamicTexture = new BABYLON.DynamicTexture("DynamicTexture", 50, scene, true);
            dynamicTexture.hasAlpha = true;
            dynamicTexture.drawText(text, 5, 40, "bold 36px Arial", color, "transparent", true);
            let plane = new BABYLON.Mesh.CreatePlane("TextPlane", size, scene, true);
            plane.material = new BABYLON.StandardMaterial("TextPlaneMaterial", scene);
            plane.material.backFaceCulling = false;
            plane.material.specularColor = new BABYLON.Color3(0, 0, 0);
            plane.material.diffuseTexture = dynamicTexture;
            return plane;
        };

        // Rescale of labels
        var labelSize = size*5;
    
        var xChar = makeTextPlane("X", "red", labelSize / 10);
        var yChar = makeTextPlane("Y", "green", labelSize / 10);
        var zChar = makeTextPlane("Z", "blue", labelSize / 10);

        camera.onViewMatrixChangedObservable.add(() => {
            let p = camera.position.clone();
            p.addInPlace(camera.getDirection(new BABYLON.Vector3(0, 0, -15)));
            p.addInPlace(camera.getDirection(new BABYLON.Vector3(0, -6, 0)));
            p.addInPlace(camera.getDirection(new BABYLON.Vector3(-6.5, 0, 0)));
            axis.xAxis.position = p.clone();
            axis.yAxis.position = p.clone();
            axis.zAxis.position = p.clone();
            xChar.position = p.clone().add(new BABYLON.Vector3(labelSize*0.3, 0, 0));
            yChar.position = p.clone().add(new BABYLON.Vector3(0, labelSize*0.3, 0));
            zChar.position = p.clone().add(new BABYLON.Vector3(0, 0, labelSize*0.3));
            xChar.lookAt(camera.position);
            yChar.lookAt(camera.position);
            zChar.lookAt(camera.position);
        });

        return axis;
    }

}

export { AxisHelper };