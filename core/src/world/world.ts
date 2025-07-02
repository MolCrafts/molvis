import {
  ArcRotateCamera,
  Color3,
  Engine,
  HemisphericLight,
  type LinesMesh,
  Scene,
  Vector3,
  Tools,
  CubeTexture,
  DirectionalLight,
  PointLight,
  SpotLight,
  ImageProcessingConfiguration,
} from "@babylonjs/core";
import { AxisHelper } from "./axes";
import { Pipeline } from "../pipeline";
import type { Box } from "../system/box";
import { MeshGroup } from "./group";

// import { Logger } from "tslog";
// const logger = new Logger({ name: "molvis-world" });

class World {
  private _engine: Engine;
  private _scene: Scene;
  private _camera: ArcRotateCamera;
  private _axes: AxisHelper;
  private _pipeline: Pipeline;
  private _boxMesh: LinesMesh | null = null;
  private _isRunning = false;

  private _meshGroup: MeshGroup;

  constructor(canvas: HTMLCanvasElement) {
    this._engine = this._initEngine(canvas);
    this._scene = this._initScene(this._engine);
    this._camera = this._initCamera();
    this._initLight();
    this._pipeline = new Pipeline();
    this._axes = this._initAxes();
    this._meshGroup = new MeshGroup("root", this._scene);
    this._meshGroup.createSubgroup("selected");
  }

  private _initEngine(canvas: HTMLCanvasElement) {
    // Ensure proper canvas setup for accurate coordinate handling
    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
      alpha: false,
      premultipliedAlpha: false,
      // powerPreference: "high-performance",
      doNotHandleContextLost: true
    });
    
    return engine;
  }

  public get meshGroup(): MeshGroup {
    return this._meshGroup;
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
    // const hemisphericLight = new HemisphericLight(
    //   "ambientLight",
    //   new Vector3(0, 1, 0),
    //   this._scene,
    // );
    // hemisphericLight.diffuse = new Color3(1, 1, 1);
    // hemisphericLight.groundColor = new Color3(0, 0, 0);
    // return hemisphericLight;

    // 1. 环境贴图强度（仅用于反射和整体亮度控制）
    // 你可以用任意一张 cubemap 或者直接设置环境颜色
    // this.scene.environmentIntensity = 0.4;  // 环境强度 0.0–1.0 之间微调

    // 2. 半球光：模拟来自天空和地面的漫反射光
    const hemiUp = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), this.scene);
    hemiUp.diffuse = new Color3(1, 1, 1);
    hemiUp.intensity = 0.8;
    hemiUp.groundColor = new Color3(0.0, 0.0, 0.0);
    
    const hemiDown = new HemisphericLight("hemiLight", new Vector3(0, -1, 0), this.scene);
    hemiDown.diffuse = new Color3(1, 1, 1);
    hemiDown.intensity = 0.8;
    hemiDown.groundColor = new Color3(0.0, 0.0, 0.0);

    // // 3. 主光源（Key Light）：用方向光来塑造分子主要阴影
    const key = new DirectionalLight("keyLight", new Vector3(-0.5, -1, -0.5), this.scene);
    key.position = new Vector3(5, 10, 5);
    key.intensity = 0.3;

    // // 4. 辅助光（Fill Light）：用点光或者聚光消除过暗区域
    const fill = new PointLight("fillLight", new Vector3(-5, 5, 5), this.scene);
    fill.intensity = 0.3;
    fill.range = 40;

    // // 5. 背光（Back Light / Rim Light）：用聚光灯勾勒分子轮廓
    const rim = new SpotLight(
      "rimLight",
      new Vector3(0, 5, -5),            // 光源位置
      new Vector3(0, -1, 1),            // 照射方向
      Math.PI / 6,                              // 光锥角度
      2,                                        // 衰减
      this.scene
    );
    rim.intensity = 0.2;

    // （可选）阴影：如果场景有平面或其他物体，可启用
    // const shadowGen = new ShadowGenerator(1024, key);
    // shadowGen.useBlurExponentialShadowMap = true;
    // shadowGen.blurKernel = 16;
    // shadowGen.addShadowCaster(yourMesh);

    // 6. 图像处理：提高对比度和开启色调映射，让光影更柔和自然
    this.scene.imageProcessingConfiguration.contrast = 1.2;
    this.scene.imageProcessingConfiguration.exposure = 1.0;
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;

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

  public isOrthographic(): boolean {
    return this._camera.mode === ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  set isRunning(value: boolean) {
    this._isRunning = value;
  }

}

export { World };
