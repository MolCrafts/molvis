import {
  ActionManager,
  ArcRotateCamera,
  Color3,
  Engine,
  HemisphericLight,
  type LinesMesh,
  PointerEventTypes,
  Scene,
  Vector3,
  Tools,
} from "@babylonjs/core";
import { AxisHelper } from "./axes";
import { Pipeline } from "../pipeline";
import type { Box } from "../system/box";

// import { Logger } from "tslog";
// const logger = new Logger({ name: "molvis-world" });

class World {
  private _engine: Engine;
  private _scene: Scene;
  private _camera: ArcRotateCamera;
  private _axes: AxisHelper;
  private _pipeline: Pipeline;
  private _boxMesh: LinesMesh | null = null;
  private _isRunning: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this._engine = this._initEngine(canvas);
    this._scene = this._initScene(this._engine);
    this._camera = this._initCamera();
    this._initLight();
    this._pipeline = new Pipeline();
    this._axes = this._initAxes();
  }

  private _initEngine(canvas: HTMLCanvasElement) {
    // Ensure proper canvas setup for accurate coordinate handling
    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
      doNotHandleContextLost: true
    });
    
    return engine;
  }

  private _initScene = (engine: Engine) => {
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    return scene;
  };

  get scene(): Scene {
    return this._scene;
  }

  get pipeline(): Pipeline {
    return this._pipeline;
  }

  public get camera(): ArcRotateCamera {
    return this._camera;
  }

  private _initCamera() {
    const camera = new ArcRotateCamera(
      "Camera",
      -Math.PI / 2,
      Math.PI / 6,
      12,
      Vector3.Zero(),
      this._scene,
    );
    camera.lowerRadiusLimit = 5;
    camera.attachControl(this._engine.getRenderingCanvas(), false);
    camera.inertia = 0;

    return camera;
  }

  private _initLight() {
    const hemisphericLight = new HemisphericLight(
      "ambientLight",
      new Vector3(0, 1, 0),
      this._scene,
    );
    hemisphericLight.diffuse = new Color3(1, 1, 1);
    hemisphericLight.groundColor = new Color3(0, 0, 0);
    return hemisphericLight;
  }

  private _initAxes() {
    return new AxisHelper(this._engine, this.camera);
  }

  public append_modifier(name: string, args: Record<string, unknown>) {
    this._pipeline.append(name, args);
  }

  public drawBox(box: Box, color: Color3 = Color3.White()) {
    if (this._boxMesh) {
      this._boxMesh.dispose();
    }
    this._boxMesh = box.toLinesMesh(this._scene, "simulation_box", color);
  }

  public takeScreenShot() {
    Tools.CreateScreenshot(this._engine, this._camera, { precision: 1.0 });
  }

  public setPerspective() {
    this._camera.mode = ArcRotateCamera.PERSPECTIVE_CAMERA;
  }

  public setOrthographic() {
    this._camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
    const ratio =
      this._engine.getRenderWidth() / this._engine.getRenderHeight();
    const ortho = this._camera.radius;
    this._camera.orthoLeft = -ortho;
    this._camera.orthoRight = ortho;
    this._camera.orthoBottom = -ortho / ratio;
    this._camera.orthoTop = ortho / ratio;
  }

  public viewFront() {
    this._camera.alpha = -Math.PI / 2;
    this._camera.beta = Math.PI / 2;
  }

  public viewBack() {
    this._camera.alpha = Math.PI / 2;
    this._camera.beta = Math.PI / 2;
  }

  public viewLeft() {
    this._camera.alpha = Math.PI;
    this._camera.beta = Math.PI / 2;
  }

  public viewRight() {
    this._camera.alpha = 0;
    this._camera.beta = Math.PI / 2;
  }

  public render() {
    this.isRunning = true;
    this._engine.runRenderLoop(() => {
      this._scene.render();
      this._axes.render();
    });
    this._engine.resize();
    window.addEventListener("resize", () => {
      this._engine.resize();
    });
  }

  public stop() {
    this.isRunning = false;
    this._engine.dispose();
  }

  public clear() {
    while (this._scene.meshes.length) {
      const mesh = this._scene.meshes[0];
      mesh.dispose();
    }
    if (this._boxMesh) {
      this._boxMesh.dispose();
      this._boxMesh = null;
    }
  }

  public resize() {
    this._engine.resize();
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  set isRunning(value: boolean) {
    this._isRunning = value;
  }

}

export { World };
