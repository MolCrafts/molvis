import * as BABYLON from "@babylonjs/core";
import Molvis from "../app"


class Selector {

    public selected: BABYLON.AbstractMesh[] = [];
    public unselected: BABYLON.AbstractMesh[] = [];
    protected molvis: Molvis;

    constructor(molvis: Molvis) {
        this.molvis = molvis;
    }

    protected select(selected: BABYLON.AbstractMesh[]) {
        let selected_before = this.selected.filter(mesh => selected.includes(mesh));
        let unselected_before = selected.filter(mesh => !selected_before.includes(mesh));
        this.unselected = selected_before;
        this.selected.push(...unselected_before);
    }

    public get n_selected(): number {
        return this.selected.length;
    }

    public get is_selected(): boolean {
        return this.n_selected > 0;
    }

    public reset() {
        for (let i = 0; i < this.selected.length; i++) {
            // unhighlight selected mesh
            let mesh = this.selected[i];
            mesh.renderOutline = false;
        }
        this.selected = [];
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
        let origin = new BABYLON.Vector3(box_origin[0], box_origin[1], box_origin[2]);
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
        return this.selected;
    }

}

class PickSelector extends Selector {

    constructor(molvis: Molvis) {
        super(molvis);
    }

    public select() {
        
        let scene = this.molvis.scene;
        let pickResult = scene.pick(scene.pointerX, scene.pointerY, undefined, true);
        if (pickResult && pickResult.pickedMesh != null)  {
            super.select([pickResult.pickedMesh]);
            return pickResult.pickedMesh;
        }
        return null;
    }

}

export { SliceSelector, PickSelector }