import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders";

import {System} from "./system";

class MolvisApp {

    private _engine: BABYLON.Engine;
    private _scene: BABYLON.Scene;
    private _camera?: BABYLON.Camera;
    private _ambient_light?: BABYLON.Light;
    private _system: System = new System();

    constructor(canvas: HTMLCanvasElement) {
        this._engine = new BABYLON.Engine(canvas);
        this._scene = new BABYLON.Scene(this._engine);
        this.set_camera(new BABYLON.Vector3(0, 0, -10), new BABYLON.Vector3(0, 0, 0));
        this.set_ambient_light();
    }

    public set_camera(position: BABYLON.Vector3, target: BABYLON.Vector3) {
        const camera = new BABYLON.ArcRotateCamera("mainCamera", 0, 0, 0, target, this._scene);
        camera.setPosition(position);
        camera.setTarget(target);
        camera.attachControl(this._engine.getRenderingCanvas()!, true);
        this._camera = camera;
    }

    public set_ambient_light() {
        var hemisphericLight = new BABYLON.HemisphericLight("ambientLight", new BABYLON.Vector3(0, 1, 0), this._scene);
        hemisphericLight.diffuse = new BABYLON.Color3(1, 1, 1);
        hemisphericLight.groundColor = new BABYLON.Color3(0, 0, 0);
        this._ambient_light = hemisphericLight;
    }

    private draw_atoms() {

        const atoms = this._system.atoms;
        for (let i = 0; i < atoms.length; i++) {
            const atom = atoms[i];
            const sphere = BABYLON.MeshBuilder.CreateSphere("atom" + i, { diameter: 1 }, this._scene);
            const xyz = atom.get("xyz");
            sphere.position = new BABYLON.Vector3(xyz[0], xyz[1], xyz[2]);
        }

    }

    private draw_box() {
        const vectrices = this._system.box.get_vertices();
        const lines:BABYLON.Vector3[][] = [];
        for (let i = 0; i < vectrices.length; i++) {
            const v1 = vectrices[i];
            const v2 = vectrices[(i + 1) % vectrices.length];
            // lines.push([v1, v2]);
            lines.push([new BABYLON.Vector3(v1[0], v1[1], v1[2]), new BABYLON.Vector3(v2[0], v2[1], v2[2])]);
            
        }
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineMesh = BABYLON.MeshBuilder.CreateLines("line" + i, { points: line }, this._scene);
        }
    }

    get system() {
        return this._system;
    }

    public run() {
        this.draw_atoms();
        this.draw_box();
        this._engine.runRenderLoop(() => {
            this._scene.render();
        });
        window.addEventListener("resize", () => {
            this._engine.resize();
        });
    }

}

export default MolvisApp;
