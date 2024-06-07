import { Engine, Scene, ArcRotateCamera, Light, Vector3, HemisphericLight, Color3, Animation } from '@babylonjs/core';
import { AxesViewer } from './axis';
import { ViewMode, IMode } from './mode';
import { Controller } from '../controller';
import { RegionView } from './region';
import { AtomView, BondView, FrameView } from './frame';
import { IModel } from '../model/system';
import { Frame } from '../model/frame';
import { GUI } from './gui';
import { Trajectory } from '../model/trajectory';
import { UpdateTrajView } from './trajectory';


export interface IRenderable {
    render(scene: Scene): void;
}

export interface IDrawable {
    name: string;
    draw(model: IModel): void;
}

export interface IPlayable {
    name: string;
    play(model: IModel): void;
}

export class World {

    // scene components
    public engine: Engine;
    public controller: Controller | null = null;
    
    public camera: ArcRotateCamera;
    public scene: Scene;
    public gui: GUI;
    
    private mode: IMode;
    private rendables: IRenderable[] = [];
    private drawables: { [key: string]: IDrawable } = {};
    private playables: { [key: string]: IPlayable } = {};
    private light: Light;

    constructor(canvas: HTMLCanvasElement) {
        this.engine = new Engine(canvas);
        this.scene = this.init_scene();
        this.camera = this.init_camera();
        this.light = this.init_light();
        this.gui = new GUI(this);

        const axes = new AxesViewer(this);
        this.rendables.push(axes);

        this.mode = new ViewMode(this);

        this.register_drawable(new RegionView(this));
        this.register_drawable(new AtomView(this));
        this.register_drawable(new BondView(this));
        this.register_drawable(new FrameView(this));

        this.register_playable(new UpdateTrajView(this, { frame_per_sec: 0.5, loop: true }));
    }

    public clear() {
        while(this.scene.meshes.length) {
            this.scene.meshes[0].dispose();
        }
    }

    public change_view_mode(mode: string) {
        if (mode === "view") {
            this.mode = new ViewMode(this);
        }
        // else if (mode === "measure") {
        //     this.mode = new MeasureMode(this);
        //     console.log("Measure mode");
        // }
    }

    public set_controller = (controller: Controller) => {
        this.controller = controller;
    }

    public draw = (model: IModel) => {

        const view = this.drawables[model.constructor.name];
        if (view) {
            view.draw(model);
        } else {
            throw new Error(`No view found for model ${model.constructor.name}`);
        }
    }

    public play = (model: IModel) => {

        const view = this.playables[model.name];
        if (view) {
            view.play(model);
        } else {
            throw new Error(`No view found for model ${model.name}`);
        }
    }

    private init_scene() {
        const scene = new Scene(this.engine);
        scene.useRightHandedSystem = true;
        return scene;
    }

    private init_camera() {
        const camera = new ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 6, 12, Vector3.Zero(), this.scene);
        camera.lowerRadiusLimit = 5;
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

    public register_renderable(renderable: IRenderable) {
        this.rendables.push(renderable);
    }

    public register_drawable(drawable: IDrawable) {
        this.drawables[drawable.name] = drawable;
    }

    public register_playable(playable: IPlayable) {
        this.playables[playable.name] = playable;
    }

    public get_drawable(name: string) {
        return this.drawables[name];
    }

    public render() {
        this.engine.runRenderLoop(() => {
            this.scene.render();
            for (let renderable of this.rendables) {
                renderable.render(this.scene);
            }
        });
        window.addEventListener("resize", () => {
            this.engine.resize();
        });
    }

}
