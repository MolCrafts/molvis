import { Engine, Scene, ArcRotateCamera, Light, Vector3, HemisphericLight, Color3 } from '@babylonjs/core';
import { AxesViewer } from './axis';
import {Mode, ViewMode} from './mode';
import System from './system';

interface IRenderable {
    render(scene: Scene): void;
}

class World {

    // scene components
    public engine: Engine;
    private light: Light;
    private render_queue: IRenderable[] = [];
    
    public camera: ArcRotateCamera;
    public scene: Scene;
    private mode: Mode;
    public system: System|null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.engine = new Engine(canvas);
        this.scene = this.init_scene();
        this.camera = this.init_camera();
        this.light = this.init_light();

        const axes = new AxesViewer(this);
        this.render_queue.push(axes);

        this.mode = new ViewMode(this);
    }

    private init_scene() {
        const scene = new Scene(this.engine);
        scene.useRightHandedSystem = true;
        return scene;
    }

    private init_camera() {
        const camera = new ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 6, 12, Vector3.Zero(), this.scene);
        camera.attachControl(this.engine.getRenderingCanvas()!, false);
        camera.inertia = 0;
        return camera;
    }

    private init_light() {
        let hemisphericLight = new HemisphericLight("ambientLight", new Vector3(0, 1, 0), this.scene);
        hemisphericLight.diffuse = new Color3(1, 1, 1);
        hemisphericLight.groundColor = new Color3(0, 0, 0);
        return hemisphericLight;
    }

    public add_renderable(renderable: IRenderable) {
        this.render_queue.push(renderable);
    }

    public render() {
        this.engine.runRenderLoop(() => {
            this.scene.render();
            for (let renderable of this.render_queue) {
                renderable.render(this.scene);
            }
        });
        window.addEventListener("resize", () => {
            this.engine.resize();
        });
    }

}

export default World;