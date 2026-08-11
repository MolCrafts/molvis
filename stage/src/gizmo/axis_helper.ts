import {
  type AbstractEngine,
  ArcRotateCamera,
  Color3,
  DynamicTexture,
  type Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  type Observer,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
  Viewport,
} from "@babylonjs/core";
import { WORLD_AXES } from "./world_axes";

const AXIS_VIEWPORT_BASE_FRACTION = 0.15;
const AXIS_VIEWPORT_SCALE = 1.2;
const AXIS_VIEWPORT_PADDING_FRACTION = 10 / 150;

/** Local cylinder axis before pivot alignment (Babylon cylinders grow along +Y). */
const CYLINDER_LOCAL_UP = new Vector3(0, 1, 0);

/**
 * Build a square, canvas-relative axis-helper viewport.
 *
 * The original helper occupied 15% of a reference canvas. Keep that ratio
 * across canvas sizes, enlarge it by 20%, and scale its inset with it.
 */
export function axisHelperViewport(
  renderWidth: number,
  renderHeight: number,
): Viewport {
  const width = Math.max(1, renderWidth);
  const height = Math.max(1, renderHeight);
  const sizePx =
    Math.min(width, height) * AXIS_VIEWPORT_BASE_FRACTION * AXIS_VIEWPORT_SCALE;
  const paddingPx = sizePx * AXIS_VIEWPORT_PADDING_FRACTION;

  return new Viewport(
    paddingPx / width,
    paddingPx / height,
    sizePx / width,
    sizePx / height,
  );
}

/** Scratch vector for label orientation — never allocated per call. */
const TMP_FORWARD = new Vector3();
/** Stable fallback ups for the near-pole singularity (treat as immutable). */
const FALLBACK_UP_WORLD_Y = new Vector3(0, 1, 0);
const FALLBACK_UP_WORLD_X = new Vector3(1, 0, 0);

/**
 * AxisViewer - A custom 3D axis gizmo with arrows and labels.
 *
 * Axes use explicit world directions (+X/+Y/+Z) via quaternion alignment,
 * sourced from the shared {@link WORLD_AXES} triad. Labels are re-oriented
 * from the gizmo camera basis (not BILLBOARDMODE_ALL) so the Z glyph cannot
 * pick up a billboard singularity reflection when the tip sits near
 * camera-up.
 */
class AxisViewer {
  private _scene: Scene;
  private _root: Mesh;
  private _labels: Mesh[] = [];

  constructor(scene: Scene, size = 1) {
    this._scene = scene;
    this._root = new Mesh("axisRoot", scene);

    const chordLength = size * 0.1;
    const arrowHeight = size * 0.25;
    const shaftDiameter = size * 0.05;

    // Right-handed, Z-up world: +X red, +Y green, +Z blue.
    for (const axis of WORLD_AXES) {
      this.createAxis(
        axis.key.toUpperCase(),
        axis.color,
        axis.direction,
        size,
        shaftDiameter,
        arrowHeight,
        chordLength,
      );
    }
  }

  /**
   * Face every label at the gizmo camera, upright w.r.t. camera up.
   *
   * `MeshBuilder.CreatePlane` has its front face along **local −Z** (normals
   * are (0,0,−1)). `FromLookDirectionRH(forward)` aims local **+Z** along
   * `forward`, so `forward` must point **away from the camera** — otherwise
   * the front face is culled and the letters vanish.
   */
  public orientLabels(camera: ArcRotateCamera): void {
    const camPos = camera.position;
    const camUp = camera.upVector;
    for (const label of this._labels) {
      // Root is identity, but use absolute position so parenting stays safe.
      label.getAbsolutePosition().subtractToRef(camPos, TMP_FORWARD);
      if (TMP_FORWARD.lengthSquared() < 1e-12) continue;
      TMP_FORWARD.normalize();

      // When looking nearly along ±camera-up (Z label near the pole), pick a
      // stable alternate up so FromLookDirectionRH does not collapse.
      let up = camUp;
      if (Math.abs(Vector3.Dot(TMP_FORWARD, camUp)) > 0.98) {
        up =
          Math.abs(camUp.y) < 0.9 ? FALLBACK_UP_WORLD_Y : FALLBACK_UP_WORLD_X;
      }

      if (!label.rotationQuaternion) {
        label.rotationQuaternion = new Quaternion();
      }
      Quaternion.FromLookDirectionRHToRef(
        TMP_FORWARD,
        up,
        label.rotationQuaternion,
      );
    }
  }

  private createAxis(
    label: string,
    color: Color3,
    direction: Vector3,
    totalLength: number,
    shaftDiameter: number,
    arrowHeight: number,
    arrowDiameter: number,
  ) {
    const material = new StandardMaterial(`${label}Mat`, this._scene);
    material.diffuseColor = color.clone();
    material.emissiveColor = color.scale(0.8);
    material.specularColor = Color3.Black();

    const shaftLen = totalLength - arrowHeight;

    const shaft = MeshBuilder.CreateCylinder(
      `shaft${label}`,
      {
        height: shaftLen,
        diameter: shaftDiameter,
        tessellation: 16,
      },
      this._scene,
    );
    shaft.material = material;
    shaft.position.y = shaftLen / 2;

    const arrow = MeshBuilder.CreateCylinder(
      `arrow${label}`,
      {
        height: arrowHeight,
        diameterTop: 0,
        diameterBottom: arrowDiameter,
        tessellation: 16,
      },
      this._scene,
    );
    arrow.material = material;
    arrow.position.y = totalLength - arrowHeight / 2;

    const pivot = new Mesh(`pivot${label}`, this._scene);
    shaft.parent = pivot;
    arrow.parent = pivot;

    const dir = direction.clone().normalize();
    pivot.rotationQuaternion = Quaternion.FromUnitVectorsToRef(
      CYLINDER_LOCAL_UP,
      dir,
      new Quaternion(),
    );
    pivot.parent = this._root;

    const labelOffset = totalLength + 0.35;
    const labelMesh = this.createLabel(label, color.toHexString());
    labelMesh.position = dir.scale(labelOffset);
    labelMesh.parent = this._root;
    this._labels.push(labelMesh);
  }

  private createLabel(text: string, color: string) {
    const size = 0.8;
    const font = "bold 80px Arial";

    const dynamicTexture = new DynamicTexture(
      `axisLabelTexture${text}`,
      { width: 128, height: 128 },
      this._scene,
      true,
    );
    dynamicTexture.hasAlpha = true;
    dynamicTexture.drawText(text, null, null, font, color, "transparent", true);

    // DOUBLESIDE: even if look-direction is briefly wrong for one frame, the
    // glyph stays visible. Front face is local −Z (see orientLabels).
    const plane = MeshBuilder.CreatePlane(
      `axisLabel${text}`,
      { size, sideOrientation: Mesh.DOUBLESIDE },
      this._scene,
    );
    const material = new StandardMaterial(
      `axisLabelMaterial${text}`,
      this._scene,
    );
    material.backFaceCulling = false;
    material.emissiveColor = Color3.White();
    material.diffuseTexture = dynamicTexture;
    material.opacityTexture = dynamicTexture;
    material.disableLighting = true;
    material.useAlphaFromDiffuseTexture = true;
    plane.material = material;

    plane.rotationQuaternion = Quaternion.Identity();
    // RH: viewing the plane front (local −Z toward camera) mirrors local +X
    // on screen, so a drawn "Z" shows as Ƨ (diagonal / instead of \). Flip X.
    plane.scaling.x = -1;
    // Disable frustum culling: labels sit in a tiny corner viewport and can
    // otherwise be culled against the full-canvas frustum.
    plane.alwaysSelectAsActiveMesh = true;

    return plane;
  }
}

/**
 * AxisHelper - Small 3D coordinate indicator in viewport corner
 * Shows XYZ axes that follow camera rotation
 */
export class AxisHelper {
  private _scene: Scene;
  private _cameraGizmo: ArcRotateCamera;
  private _engine: Engine;
  private _resizeObserver: Observer<AbstractEngine>;
  private _viewer: AxisViewer;
  /** Last main-camera pose; camera sync + label orientation only run on change. */
  private _lastPose = {
    alpha: Number.NaN,
    beta: Number.NaN,
    upX: Number.NaN,
    upY: Number.NaN,
    upZ: Number.NaN,
  };

  public constructor(engine: Engine, camera: ArcRotateCamera) {
    this._engine = engine;
    const scene = new Scene(engine);
    this._scene = scene;
    // Match the main World scene: right-handed + Z-up.
    scene.useRightHandedSystem = true;
    scene.autoClear = false;

    this._cameraGizmo = new ArcRotateCamera(
      "camAxis",
      Math.PI / 2,
      Math.PI / 2,
      8,
      Vector3.Zero(),
      scene,
    );
    // Must set upVector before first render so alpha/beta map onto Z-up.
    this._cameraGizmo.upVector = camera.upVector.clone();

    new HemisphericLight("lightAxis", new Vector3(0, 0, 1), scene);

    this._viewer = new AxisViewer(scene, 2.5);

    // Initial setup
    this.updateViewport();
    // Orient once immediately so the first frame is not blank.
    this.syncToCamera(camera);

    // Sync gizmo camera + label orientation when the main camera moved.
    scene.registerBeforeRender(() => {
      if (!camera) return;
      this.syncToCamera(camera);
    });

    // Follow the actual render-canvas size, including container-only resizes.
    this._resizeObserver = engine.onResizeObservable.add(this.updateViewport);
  }

  /**
   * Copy the main camera pose onto the gizmo camera and re-orient labels.
   * No-op while the camera is idle — the corner scene still re-renders each
   * frame (the main scene clears the canvas), but the CPU-side sync work
   * collapses to a five-float comparison.
   */
  private syncToCamera(camera: ArcRotateCamera): void {
    const up = camera.upVector;
    const pose = this._lastPose;
    if (
      camera.alpha === pose.alpha &&
      camera.beta === pose.beta &&
      up.x === pose.upX &&
      up.y === pose.upY &&
      up.z === pose.upZ
    ) {
      return;
    }
    pose.alpha = camera.alpha;
    pose.beta = camera.beta;
    pose.upX = up.x;
    pose.upY = up.y;
    pose.upZ = up.z;

    this._cameraGizmo.upVector.copyFrom(up);
    this._cameraGizmo.alpha = camera.alpha;
    this._cameraGizmo.beta = camera.beta;
    this._viewer.orientLabels(this._cameraGizmo);
  }

  // Bind creates a stable function reference for cleanup
  private updateViewport = () => {
    this._cameraGizmo.viewport = axisHelperViewport(
      this._engine.getRenderWidth(),
      this._engine.getRenderHeight(),
    );
  };

  public render() {
    this._scene.render();
  }

  public dispose() {
    this._engine.onResizeObservable.remove(this._resizeObserver);
    this._scene.dispose();
  }
}
