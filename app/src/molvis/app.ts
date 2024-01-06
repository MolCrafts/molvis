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
        for (let atom of atoms) {
            let xyz = atom.props.xyz;
            let sphere = BABYLON.MeshBuilder.CreateSphere("atom", { diameter: 1 }, this._scene);
            sphere.position = new BABYLON.Vector3(xyz[0], xyz[1], xyz[2]);

        }

    }

    private draw_box() {
        const vectrices = this._system.box.get_vertices().map((v) => {
            return new BABYLON.Vector3(v[0], v[1], v[2]);
        });
        const corners = [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 0],
            [4, 5],
            [5, 6],
            [6, 7],
            [7, 4],
            [0, 4],
            [1, 5],
            [2, 6],
            [3, 7]
        ]
        for (let i = 0; i < corners.length; i++) {
            const corner = corners[i];
            let line = BABYLON.MeshBuilder.CreateLines("line", { points: [vectrices[corner[0]], vectrices[corner[1]]] }, this._scene);
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
