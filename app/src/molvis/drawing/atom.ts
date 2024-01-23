import * as BABYLON from "@babylonjs/core";
import Molvis from "../app"

class Brush {
    protected molvis: Molvis;

    constructor(molvis: Molvis) {
        this.molvis = molvis;
    }
}

class AtomBrush extends Brush {

    constructor(molvis: Molvis) {
        super(molvis);
    }

    public draw_on_pointer() {
        
        let scene = this.molvis.scene;
        const natoms = this.molvis.system.natoms;
        const x = scene.pointerX;
        const y = scene.pointerY;
        const ray = scene.createPickingRay(x, y, BABYLON.Matrix.Identity(), scene.activeCamera);
        var rayHelper = new BABYLON.RayHelper(ray);
        rayHelper.show(scene, new BABYLON.Color3(1, 1, 0.5));
        const xyz = ray.origin.add(ray.direction.scale(10));
        this.draw(`atom${natoms}`, xyz);

    }

    // classmethod draw
    

    public draw(name:string, xyz: BABYLON.Vector3, diameter: number = 1) {
        let scene = this.molvis.scene;
        let sphere = BABYLON.MeshBuilder.CreateSphere(name, {diameter: 1}, scene);
        sphere.position.x = xyz.x;
        sphere.position.y = xyz.y;
        sphere.position.z = xyz.z;
    }

}

export {AtomBrush};