import * as BABYLON from "@babylonjs/core";
import Modifier from "./modifier"
import Molvis from "../app"

class Selector extends Modifier {

    public selected: BABYLON.AbstractMesh[] = [];
    public unselected: BABYLON.AbstractMesh[] = [];

    constructor(molvis: Molvis) {
        super(molvis);
    }

    public modify() {

        for (let i = 0; i < this.selected.length; i++) {
            // highlight selected mesh
            let mesh = this.selected[i];
            mesh.renderOutline = true;
        }

        for (let i = 0; i < this.unselected.length; i++) {
            // unhighlight unselected mesh
            let mesh = this.unselected[i];
            mesh.renderOutline = false;
        }

        this.unselected = [];

    }

}

class SliceSelector extends Selector {

    public normx: number = 0;
    public normy: number = 0;
    public normz: number = 0;
    public dist: number = 0;

    constructor(molvis: Molvis, normx: number, normy: number, normz: number, dist: number) {
        super(molvis);
        this.normx = normx;
        this.normy = normy;
        this.normz = normz;
        this.dist = dist;
    }
    
    public select() {
        let scene = this.molvis.scene;
        let box_origin = this.molvis.system.box.get_origin();
        let origin = new BABYLON.Vector3(box_origin.get(0), box_origin.get(1), box_origin.get(2));
        let plane = BABYLON.Plane.FromPositionAndNormal(
            origin,
            new BABYLON.Vector3(this.normx, this.normy, this.normz)
        );
        // select mesh in other side of the plane
        let meshes = scene.meshes;
        for (let i = 0; i < meshes.length; i++) {
            let mesh = meshes[i];
            let mesh_origin = mesh.getBoundingInfo().boundingBox.center;
            let distance = plane.signedDistanceTo(mesh_origin);
            if (distance > this.dist) {
                this.selected.push(mesh);
            }
        }
    }

}

class PickSelector extends Selector {

    constructor(molvis: Molvis) {
        super(molvis);
    }

    public select() {
        
        let scene = this.molvis.scene;
        let pickResult = scene.pick(scene.pointerX, scene.pointerY, undefined, true);

        if (pickResult && pickResult.pickedMesh) {
            if (this.selected.includes(pickResult.pickedMesh)) {
                // remove it
                let index = this.selected.indexOf(pickResult.pickedMesh);
                const unselected = this.selected.splice(index, 1);
                this.unselected.push(unselected[0]);
            } else this.selected.push(pickResult.pickedMesh);

            return pickResult.hit;
        }
    }

    public modify(): void {
        super.modify();
    }

}

export { SliceSelector, PickSelector }