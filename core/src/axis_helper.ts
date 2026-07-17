import * as BABYLON from "@babylonjs/core";
import {
  type AbstractEngine,
  type ArcRotateCamera,
  Color3,
  DynamicTexture,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  type Observer,
  type Scene,
  StandardMaterial,
  Vector3,
  Viewport,
} from "@babylonjs/core";

const AXIS_VIEWPORT_BASE_FRACTION = 0.15;
const AXIS_VIEWPORT_SCALE = 1.2;
const AXIS_VIEWPORT_PADDING_FRACTION = 10 / 150;

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

/**
 * AxisViewer - A custom 3D axis gizmo with arrows and labels.
 * Replaces default AxesViewer for better aesthetics.
 */
class AxisViewer {
  private _scene: Scene;
  private _root: Mesh;

  constructor(scene: Scene, size = 1) {
    this._scene = scene;
    this._root = new Mesh("axisRoot", scene);

    const chordLength = size * 0.1;
    const arrowHeight = size * 0.25;
    const shaftHeight = size - arrowHeight;
    const shaftDiameter = size * 0.05;

    // X Axis (Red)
    this.createAxis(
      "X",
      Color3.Red(),
      new Vector3(shaftHeight / 2 + arrowHeight, 0, 0), // Position? No, cylinder centers
      new Vector3(0, 0, -Math.PI / 2),
      size,
      shaftDiameter,
      arrowHeight,
      chordLength,
    );

    // Y Axis (Green)
    this.createAxis(
      "Y",
      Color3.Green(),
      new Vector3(0, size, 0),
      Vector3.Zero(),
      size,
      shaftDiameter,
      arrowHeight,
      chordLength,
    );

    // Z Axis (Blue)
    this.createAxis(
      "Z",
      Color3.Blue(),
      new Vector3(0, 0, size),
      new Vector3(Math.PI / 2, 0, 0),
      size,
      shaftDiameter,
      arrowHeight,
      chordLength,
    );
  }

  private createAxis(
    label: string,
    color: Color3,
    _direction: Vector3, // Not used directly, we rotate
    rotation: Vector3,
    totalLength: number,
    shaftDiameter: number,
    arrowHeight: number,
    arrowDiameter: number,
  ) {
    const material = new StandardMaterial(`${label}Mat`, this._scene);
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.8);
    material.specularColor = Color3.Black();

    // Shaft
    const shaft = MeshBuilder.CreateCylinder(
      `shaft${label}`,
      {
        height: totalLength - arrowHeight,
        diameter: shaftDiameter,
        tessellation: 16,
      },
      this._scene,
    );
    shaft.material = material;
    shaft.position.y = (totalLength - arrowHeight) / 2;

    // Arrow Cap (Cone)
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

    // Group Shaft + Arrow into Pivot for rotation
    const pivot = new Mesh(`pivot${label}`, this._scene);
    shaft.parent = pivot;
    arrow.parent = pivot;

    pivot.rotation = rotation;
    pivot.parent = this._root;

    // LABEL (Separate, not rotated, to ensure billboard works upright)
    // Calculate dimensions
    const labelOffset = totalLength + 0.35;
    // Transform the local "up" vector (0,1,0) by the rotation to find axis tip direction
    // Then scale by offset
    const directionVec = new Vector3(0, 1, 0);

    // Apply rotation (Euler)
    const rotationMatrix = BABYLON.Matrix.RotationYawPitchRoll(
      rotation.y,
      rotation.x,
      rotation.z,
    );
    const finalPos = Vector3.TransformCoordinates(
      directionVec.scale(labelOffset),
      rotationMatrix,
    );

    const labelMesh = this.createLabel(label, color.toHexString());
    if (label === "Z") {
      // Correct the Z glyph's roll in the right-handed billboard scene.
      labelMesh.rotation.z = Math.PI;
    }
    labelMesh.position = finalPos;
    labelMesh.parent = this._root;
  }

  private createLabel(text: string, color: string) {
    const size = 0.8; // Larger plane
    const font = "bold 80px Arial"; // Crisper font

    const dynamicTexture = new DynamicTexture(
      `axisLabelTexture${text}`,
      128,
      this._scene,
      true,
    );
    dynamicTexture.hasAlpha = true;
    dynamicTexture.drawText(text, null, null, font, color, "transparent", true);

    const plane = MeshBuilder.CreatePlane(
      `axisLabel${text}`,
      { size },
      this._scene,
    );
    const material = new StandardMaterial(
      `axisLabelMaterial${text}`,
      this._scene,
    );
    material.backFaceCulling = false;
    material.emissiveColor = Color3.White();
    material.diffuseTexture = dynamicTexture;
    material.disableLighting = true; // Always visible
    plane.material = material;

    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    // In the right-handed gizmo scene, billboard text appears mirrored without an X flip.
    plane.scaling.x = -1;

    return plane;
  }
}

/**
 * AxisHelper - Small 3D coordinate indicator in viewport corner
 * Shows XYZ axes that follow camera rotation
 */
export class AxisHelper {
  private _scene: BABYLON.Scene;
  private _cameraGizmo: BABYLON.ArcRotateCamera;
  private _engine: BABYLON.Engine;
  private _resizeObserver: Observer<AbstractEngine>;

  public constructor(engine: BABYLON.Engine, camera: ArcRotateCamera) {
    this._engine = engine;
    const scene = new BABYLON.Scene(engine);
    this._scene = scene;
    scene.useRightHandedSystem = true;
    scene.autoClear = false;

    this._cameraGizmo = new BABYLON.ArcRotateCamera(
      "camAxis",
      Math.PI / 2,
      Math.PI / 2,
      8,
      Vector3.Zero(),
      scene,
    );
    this._cameraGizmo.upVector = camera.upVector.clone();

    new HemisphericLight("lightAxis", new Vector3(0, 0, 1), scene);

    new AxisViewer(scene, 2.5);

    // Initial setup
    this.updateViewport();

    // Sync camera on render
    scene.registerBeforeRender(() => {
      if (camera) {
        this._cameraGizmo.upVector.copyFrom(camera.upVector);
        this._cameraGizmo.alpha = camera.alpha;
        this._cameraGizmo.beta = camera.beta;
        // Keep radius fixed
      }
    });

    // Follow the actual render-canvas size, including container-only resizes.
    this._resizeObserver = engine.onResizeObservable.add(this.updateViewport);
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
