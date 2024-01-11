import * as BABYLON from "@babylonjs/core";
import { System } from "./system";
import { AxisHelper } from "./axis_helper";
// import { AtomSelector } from "./selector";

class MolvisApp {

    private _engine: BABYLON.Engine;
    private _scene: BABYLON.Scene;
    private _camera: BABYLON.ArcRotateCamera;
    private _axis_scene: AxisHelper;
    private _ambient_light: BABYLON.Light;
    private _system: System = new System();

    constructor(canvas: HTMLCanvasElement) {
        this._engine = new BABYLON.Engine(canvas);
        this._scene = this._create_scene(this._engine);
        this._scene.useRightHandedSystem = true;
        this._camera = this.set_camera();
        this._ambient_light = this.set_ambient_light();
        this._axis_scene = new AxisHelper(this._engine, this._camera);
    }

    private _create_scene(engine: BABYLON.Engine) {
        const scene = new BABYLON.Scene(engine);
        scene.useRightHandedSystem = true;

        // // register events
        // scene.onPointerPick = (evt, pickResult) => {
        //     if (pickResult.hit && pickResult.pickedMesh) {
        //         pickResult.pickedMesh.renderOutline = !pickResult.pickedMesh.renderOutline;
        //     }
        // }

        return scene;
    }


    public set_camera() {
        const camera = new BABYLON.ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 6, 12, BABYLON.Vector3.Zero(), this._scene);
        camera.attachControl(this._engine.getRenderingCanvas()!, true);
        return camera;
    }

    public set_ambient_light() {
        let hemisphericLight = new BABYLON.HemisphericLight("ambientLight", new BABYLON.Vector3(0, 1, 0), this._scene);
        hemisphericLight.diffuse = new BABYLON.Color3(1, 1, 1);
        hemisphericLight.groundColor = new BABYLON.Color3(0, 0, 0);
        return hemisphericLight;
    }

    private draw_atoms() {

        const atoms = this._system.atoms;

        // const selector = new AtomSelector(this._scene);

        for (let atom of atoms) {
            let xyz = atom.props.xyz;
            let sphere = BABYLON.MeshBuilder.CreateSphere("atom", { diameter: 1 }, this._scene);
            sphere.position = new BABYLON.Vector3(xyz[0], xyz[1], xyz[2]);
            // selector.selectify(sphere);
        }

    }

    private draw_bonds() {
        const bonds = this._system.bonds;
        for (let bond of bonds) {
            let r1 = BABYLON.Vector3.FromArray(bond.atom1.props.xyz);
            let r2 = BABYLON.Vector3.FromArray(bond.atom2.props.xyz);
            let distance = BABYLON.Vector3.Distance(r1, r2);
            let cylinder = BABYLON.MeshBuilder.CreateCylinder("bond", { height: distance, diameter: 0.1 }, this._scene);
            cylinder.position = r1.add(r2).scale(0.5);
            let v1 = r2.subtract(r1);
            v1.normalize();
            let v2 = new BABYLON.Vector3(0, 1, 0);
            let axis = BABYLON.Vector3.Cross(v2, v1);
            axis.normalize();

            let angle = BABYLON.Vector3.Dot(v1, v2);
            angle = Math.acos(angle);
            cylinder.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis, angle);

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
        this.draw_bonds();
        this.draw_box();
        this._engine.runRenderLoop(() => {
            this._scene.render();
            this._axis_scene.render();
        });
        window.addEventListener("resize", () => {
            this._engine.resize();
        });
    }

}

export default MolvisApp;
