import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  type Engine,
  FxaaPostProcess,
  HemisphericLight,
  Scene,
  Tools,
  Vector3,
} from "@babylonjs/core";
// Inspector is lazy-loaded to avoid bundling 17MB in the main chunk
// import { Inspector } from "@babylonjs/inspector";
import type { MolvisApp } from "./app";
import { AxisHelper } from "./axis_helper";
import { CameraAnimator } from "./camera/animator";
import { fitBoxToView, ISO_ALPHA, ISO_BETA } from "./camera/fit";
import { computeObb } from "./camera/obb";
import { GridGround } from "./grid";
import { Highlighter } from "./highlighter";
import type { ModeManager } from "./mode";
import { Picker } from "./picker";
import { SceneIndex } from "./scene_index";
import { SelectionManager } from "./selection_manager";
import { TargetIndicator } from "./target_indicator";
import { logger } from "./utils/logger";
import { ViewportSettings } from "./viewport_settings";

/** Copy a WASM Float64 array out to owned memory and free the handle. */
function copyAndFreeF64(wa: {
  toCopy(): Float64Array;
  free(): void;
}): Float64Array {
  try {
    return wa.toCopy();
  } finally {
    wa.free();
  }
}

export class World {
  private _engine: Engine;
  private _app: MolvisApp;
  private _scene: Scene;
  private _camera: ArcRotateCamera;
  private _fxaa?: FxaaPostProcess;
  private _modeManager?: ModeManager;
  private _lastRadius = 10;

  // Viewport/Camera settings
  public viewportSettings: ViewportSettings;
  public targetIndicator: TargetIndicator;
  public axisHelper: AxisHelper;
  public grid: GridGround;
  public cameraAnimator: CameraAnimator;

  // New unified selection system
  public sceneIndex: SceneIndex;
  public selectionManager: SelectionManager;
  public highlighter: Highlighter;
  public picker: Picker;

  constructor(canvas: HTMLCanvasElement, engine: Engine, app: MolvisApp) {
    this._engine = engine;
    this._app = app;

    const scene = new Scene(engine);
    // Hover/pick uses the custom Picker pipeline, so disable Babylon's
    // built-in pointer-move picking to avoid duplicate per-move ray tests.
    scene.skipPointerMovePicking = true;
    scene.autoClear = true;
    scene.autoClearDepthAndStencil = true;

    if (this._app.config.useRightHandedSystem) {
      scene.useRightHandedSystem = true;
    }

    const camera = new ArcRotateCamera(
      "camera",
      Math.PI / 4, // alpha – 45° in XY plane
      Math.acos(1 / Math.sqrt(3)), // beta – view from (a,a,a) direction
      10, // radius
      Vector3.Zero(),
      scene,
    );
    // Use Z as global up axis in a right-handed coordinate system.
    camera.upVector = new Vector3(0, 0, 1);
    camera.attachControl(canvas, true);

    this._lastRadius = camera.radius;

    // Sync orthographic zoom bounds with radius changes
    scene.onBeforeRenderObservable.add(() => {
      if (camera.mode === 1) {
        if (
          this._lastRadius > 0 &&
          Math.abs(camera.radius - this._lastRadius) > 0.0001
        ) {
          const scale = camera.radius / this._lastRadius;
          if (
            camera.orthoTop !== null &&
            camera.orthoBottom !== null &&
            camera.orthoLeft !== null &&
            camera.orthoRight !== null
          ) {
            camera.orthoTop *= scale;
            camera.orthoBottom *= scale;
            camera.orthoLeft *= scale;
            camera.orthoRight *= scale;
          }
        }
      }
      this._lastRadius = camera.radius;
    });

    scene.activeCamera = camera;

    this.viewportSettings = new ViewportSettings(scene, camera);
    this.targetIndicator = new TargetIndicator(scene);
    this.axisHelper = new AxisHelper(this._engine, camera);
    this.grid = new GridGround(scene, camera, this._engine);
    const hemiLight = new HemisphericLight(
      "hemiLight",
      new Vector3(0, 0, 1),
      scene,
    );
    hemiLight.intensity = 0.84;
    hemiLight.groundColor = new Color3(0.72, 0.72, 0.72);
    hemiLight.specular = Color3.Black();
    const dirLight = new DirectionalLight(
      "dirLight",
      new Vector3(0, 0, 1),
      scene,
    );
    dirLight.parent = camera;
    dirLight.intensity = 0.48;
    dirLight.specular = new Color3(0.6, 0.6, 0.6);
    this.sceneIndex = new SceneIndex();
    this.selectionManager = new SelectionManager(this.sceneIndex);
    this.highlighter = new Highlighter(app, scene);
    this.picker = new Picker(app, scene);
    this.selectionManager.on("selection-change", (state) =>
      this.highlighter.highlightSelection(state),
    );

    this._scene = scene;
    this._camera = camera;

    // Programmable camera trajectories (turntable preview + deterministic
    // export) render through a dedicated camera so the user's interactive
    // view is never mutated. See core/src/camera/.
    this.cameraAnimator = new CameraAnimator({
      scene,
      mainCamera: camera,
      viewport: this.viewportSettings.getConfig(),
      renderOnce: () => this.renderOnce(),
      getBounds: () => this.sceneIndex.getBounds(),
      getAspectRatio: (cam) => this._engine.getAspectRatio(cam),
    });
  }

  public get scene(): Scene {
    return this._scene;
  }

  public get camera(): ArcRotateCamera {
    return this._camera;
  }

  public get mode() {
    return this._modeManager?.currentMode;
  }

  public setMode(modeManager: ModeManager) {
    this._modeManager = modeManager;
  }

  // Camera control methods
  public focusOn(target: Vector3) {
    this.camera.setTarget(target);
  }

  /**
   * Frame the scene.
   *
   * Builds a radius-aware oriented bounding box of the atoms (optionally
   * including the PBC cell corners), then fits it per-axis to the viewport.
   * `viewDirection: "auto"` looks down the structure's minor axis for the
   * largest silhouette; the default `"iso"` keeps the stable α=45°/β=60° view.
   */
  public resetCamera(options?: {
    viewDirection?: "iso" | "auto";
    frameBox?: boolean;
  }): void {
    const viewDirection = options?.viewDirection ?? "iso";
    const merged = this.collectFramingPoints(options?.frameBox ?? false);

    if (!merged) {
      // Fallback if no data
      this.camera.setTarget(Vector3.Zero());
      this.camera.radius = 10;
      this.camera.alpha = ISO_ALPHA;
      this.camera.beta = ISO_BETA;
      return;
    }

    const obb = computeObb(merged.points, merged.radii);
    const fit = fitBoxToView(
      obb,
      this.camera.fov,
      this._engine.getAspectRatio(this.camera),
      { viewDirection },
    );

    this.camera.setTarget(fit.center);
    this.camera.radius = fit.radius;
    this.camera.alpha = fit.direction.alpha;
    this.camera.beta = fit.direction.beta;

    // Grow the clip planes so the framed scene is never culled. The default
    // `farClipPlane` (1000 Å, tuned for ordinary molecules) is smaller than
    // the camera distance needed to frame large structures (e.g. a packing
    // box spanning ~2000 Å sits entirely beyond a 1000 Å far plane → blank
    // viewport). The fit scales the camera *distance* with the scene but not
    // the frustum, so do it here. Only ever push the far plane out — never
    // shrink below the user's configured value — and lift the near plane
    // proportionally to preserve depth-buffer precision.
    const maxExtent =
      2 * Math.max(obb.halfExtents[0], obb.halfExtents[1], obb.halfExtents[2]);
    const needFar = (fit.radius + maxExtent) * 2;
    if (needFar > this.camera.maxZ) {
      this.camera.maxZ = needFar;
      this.camera.minZ = Math.max(this.camera.minZ, needFar / 50000);
    }
  }

  /**
   * Gather the point cloud (centers + radii) used to frame the scene: the
   * radius-aware atom data, optionally augmented with the eight PBC cell
   * corners (radius 0). Returns `null` when there is nothing to frame.
   */
  private collectFramingPoints(
    frameBox: boolean,
  ): { points: Float64Array; radii: Float64Array } | null {
    const atoms = this.sceneIndex.getBoundsData();
    const corners =
      frameBox && this._app.frame?.simbox
        ? copyAndFreeF64(this._app.frame.simbox.get_corners())
        : null;

    if (!corners || corners.length < 24) {
      return atoms;
    }

    const cornerCount = 8;
    const atomCount = atoms ? atoms.radii.length : 0;
    const total = atomCount + cornerCount;
    const points = new Float64Array(total * 3);
    const radii = new Float64Array(total); // corners contribute radius 0
    if (atoms) {
      points.set(atoms.points, 0);
      radii.set(atoms.radii, 0);
    }
    points.set(corners.subarray(0, cornerCount * 3), atomCount * 3);
    return { points, radii };
  }

  public takeScreenShot() {
    logger.info("[World] Taking screenshot...");
    Tools.CreateScreenshotUsingRenderTarget(
      this._engine,
      this.camera,
      { precision: 1 },
      (data) => {
        const link = document.createElement("a");
        link.download = `molvis-screenshot-${Date.now()}.png`;
        link.href = data;
        link.click();
        logger.info("[World] Screenshot downloaded");
      },
    );
  }

  /**
   * Start the render loop
   */
  public start() {
    this._engine.runRenderLoop(() => {
      this.renderOnce();
      const fps = this._engine.getFps();
      this._app.events.emit("fps-change", fps);
    });
  }

  /**
   * Stop the render loop
   */
  public stop() {
    this._engine.stopRenderLoop();
  }

  public async toggleInspector() {
    const scene = this.scene;
    if (scene.debugLayer.isVisible()) {
      scene.debugLayer.hide();
      return;
    }
    const { Inspector } = await import("@babylonjs/inspector");
    Inspector.Show(scene, {
      embedMode: true,
    });
  }

  /**
   * Resize the engine and immediately re-render so the canvas is never
   * displayed in a cleared (blank) state between resize and the next
   * render-loop tick.
   */
  public resize() {
    this._engine.resize();
    this.renderOnce();
  }

  public renderOnce() {
    this.scene.render();
    this.axisHelper.render();
    this._app.overlayManager.updateScreenPositions();
  }

  /**
   * Apply graphics settings
   */
  public applyGraphicsSettings(config: {
    shadows?: boolean;
    postProcessing?: boolean;
    ssao?: boolean;
    bloom?: boolean;
    ssr?: boolean;
    dof?: boolean;
    fxaa?: boolean;
    hardwareScaling?: number;
  }) {
    if (!config) return;

    // 1. Hardware Scaling (Resolution)
    // `hardwareScaling` is a quality multiplier relative to the display's native DPR.
    // 1.0 = native DPR, 0.5 = lower quality / faster, 2.0 = supersample / sharper.
    if (config.hardwareScaling !== undefined) {
      const quality = Number.isFinite(config.hardwareScaling)
        ? Math.max(config.hardwareScaling, 0.1)
        : 1.0;
      const devicePixelRatio = window.devicePixelRatio || 1;
      this._engine.setHardwareScalingLevel(1.0 / (quality * devicePixelRatio));
    }

    // 2. FXAA
    if (config.fxaa) {
      if (!this._fxaa) {
        this._fxaa = new FxaaPostProcess("fxaa", 1.0, this.camera);
      }
    } else {
      if (this._fxaa) {
        this._fxaa.dispose();
        this._fxaa = undefined;
      }
    }

    // 3. Shadows & Post-Processing
    // Currently we don't use ShadowGenerator or Pipeline
  }
}
