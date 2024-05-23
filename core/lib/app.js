import { Engine } from "@babylonjs/core/Engines";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { AxisHelper } from "./axis";
class Molvis {
    // scene components
    engine;
    scene;
    camera;
    axis;
    light;
    // system
    // private box: Box;
    // private box_artist: BoxArtist;
    // private frame: Frame;
    // private frame_artist: FrameArtist;
    constructor(canvas) {
        this.engine = new Engine(canvas);
        this.scene = this.init_scene();
        this.camera = this.init_camera();
        this.light = this.init_light();
        this.axis = new AxisHelper(this.engine, this.camera);
        // this.frame = new Frame();
        // this.frame_artist = new FrameArtist(this.scene);
        // this.box = new Box();
        // this.box_artist = new BoxArtist(this.scene);
    }
    init_scene() {
        const scene = new Scene(this.engine);
        scene.useRightHandedSystem = true;
        return scene;
    }
    init_camera() {
        const camera = new ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 6, 12, Vector3.Zero(), this.scene);
        camera.attachControl(this.engine.getRenderingCanvas(), false);
        camera.inertia = 0;
        return camera;
    }
    init_light() {
        let hemisphericLight = new HemisphericLight("ambientLight", new Vector3(0, 1, 0), this.scene);
        hemisphericLight.diffuse = new Color3(1, 1, 1);
        hemisphericLight.groundColor = new Color3(0, 0, 0);
        return hemisphericLight;
    }
    // private draw_bonds() {
    //     const bonds = this._system.bonds;
    //     for (let bond of bonds) {
    //         let r1 = Vector3.FromArray(bond.atom1.props.xyz);
    //         let r2 = Vector3.FromArray(bond.atom2.props.xyz);
    //         let distance = Vector3.Distance(r1, r2);
    //         let cylinder = MeshBuilder.CreateCylinder("bond", { height: distance, diameter: 0.1 }, this.scene);
    //         cylinder.position = r1.add(r2).scale(0.5);
    //         let v1 = r2.subtract(r1);
    //         v1.normalize();
    //         let v2 = new Vector3(0, 1, 0);
    //         let axis = Vector3.Cross(v2, v1);
    //         axis.normalize();
    //         let angle = Vector3.Dot(v1, v2);
    //         angle = Math.acos(angle);
    //         cylinder.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
    //     }
    // }
    // private draw_box() {
    // }
    run() {
        this.engine.runRenderLoop(() => {
            this.scene.render();
            this.axis.render();
            // this.frame_artist.draw(this.frame);
            // this.box_artist.draw(this.box);
        });
        window.addEventListener("resize", () => {
            this.engine.resize();
        });
    }
}
export default Molvis;
//# sourceMappingURL=app.js.map