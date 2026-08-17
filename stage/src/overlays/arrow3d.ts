/**
 * Arrow3DOverlay — a 3D arrow in world space.
 *
 * Rendered as a cylinder (shaft) + cone (head) parented under a TransformNode.
 * The arrow lives entirely in BabylonJS world space and follows camera movement
 * naturally without any per-frame DOM projection.
 */

import type { Scene } from "@babylonjs/core";
import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { Arrow3DProps, Overlay, Vec3 } from "./types";

const DEFAULT_COLOR = "#ff4444";
const DEFAULT_SHAFT_RADIUS = 0.1;
const DEFAULT_HEAD_RATIO = 0.25;
const DEFAULT_OPACITY = 1;

let _counter = 0;
function nextId(): string {
  return `arrow3d_${++_counter}`;
}

/** Parse a CSS hex color string into a BabylonJS Color3. */
function hexToColor3(hex: string): Color3 {
  const h = hex.replace(/^#/, "");
  const r = Number.parseInt(h.substring(0, 2), 16) / 255;
  const g = Number.parseInt(h.substring(2, 4), 16) / 255;
  const b = Number.parseInt(h.substring(4, 6), 16) / 255;
  return new Color3(r, g, b);
}

/**
 * Compute the quaternion that rotates the Y-axis to align with `dir`.
 * Handles degenerate cases (zero-length or anti-parallel).
 */
function quaternionFromYToDir(dir: Vector3): Quaternion {
  const len = dir.length();
  if (len < 1e-10) return Quaternion.Identity();
  const n = dir.scale(1 / len);
  const dot = Vector3.Dot(Vector3.Up(), n);
  if (dot > 0.9999) return Quaternion.Identity();
  if (dot < -0.9999) {
    return Quaternion.RotationAxis(Vector3.Right(), Math.PI);
  }
  const axis = Vector3.Cross(Vector3.Up(), n).normalize();
  return Quaternion.RotationAxis(
    axis,
    Math.acos(Math.max(-1, Math.min(1, dot))),
  );
}

export class Arrow3DOverlay implements Overlay {
  readonly id: string;
  readonly type = "arrow3d" as const;

  private _props: Required<Arrow3DProps>;
  private _scene: Scene;
  private _root: TransformNode;
  private _material: StandardMaterial;

  private constructor(id: string, props: Required<Arrow3DProps>, scene: Scene) {
    this.id = id;
    this._props = props;
    this._scene = scene;
    this._material = this._buildMaterial();
    this._root = this._buildMeshes();
  }

  static create(scene: Scene, props: Arrow3DProps): Arrow3DOverlay {
    const full = resolveDefaults(props);
    return new Arrow3DOverlay(nextId(), full, scene);
  }

  get props(): Readonly<Required<Arrow3DProps>> {
    return this._props;
  }

  get visible(): boolean {
    return this._root.isEnabled();
  }

  set visible(v: boolean) {
    this._root.setEnabled(v);
  }

  /**
   * Update props and rebuild meshes.
   * Returns `this` for chaining; the OverlayManager reference remains valid.
   */
  update(patch: Partial<Arrow3DProps>): this {
    this._props = resolveDefaults({ ...this._props, ...patch });
    this._rebuildMeshes();
    return this;
  }

  dispose(): void {
    for (const m of this._root.getChildMeshes()) m.dispose();
    this._root.dispose();
    this._material.dispose();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _buildMaterial(): StandardMaterial {
    const mat = new StandardMaterial(`${this.id}_mat`, this._scene);
    const color = hexToColor3(this._props.color);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.6);
    mat.alpha = this._props.opacity;
    mat.disableLighting = false;
    // Translucent arrows must NOT write depth — otherwise the arrow
    // body would block atoms/bonds behind it on the GL_LESS test. The
    // shaft and cone meshes are also pinned to alphaIndex = MAX_VALUE
    // (default), so they sort after impostors which carry alphaIndex=1.
    // Mirrors the mark_atom halo fix.
    if (this._props.opacity < 1) {
      mat.disableDepthWrite = true;
    }
    return mat;
  }

  private _buildMeshes(): TransformNode {
    const { from, to, shaftRadius, headRatio, headRadius, opacity } =
      this._props;

    const fromVec = new Vector3(from[0], from[1], from[2]);
    const toVec = new Vector3(to[0], to[1], to[2]);
    const dir = toVec.subtract(fromVec);
    const totalLen = dir.length();

    const root = new TransformNode(`${this.id}_root`, this._scene);
    root.position = fromVec.clone();

    if (totalLen < 1e-10) return root;

    const headLen = totalLen * headRatio;
    const shaftLen = totalLen - headLen;
    const coneRadius = headRadius ?? shaftRadius * 3;

    // Shaft cylinder: from origin upward along Y, length = shaftLen
    const shaft = MeshBuilder.CreateCylinder(
      `${this.id}_shaft`,
      {
        height: shaftLen,
        diameter: shaftRadius * 2,
        tessellation: 8,
        cap: Mesh.NO_CAP,
      },
      this._scene,
    );
    shaft.position = new Vector3(0, shaftLen / 2, 0);
    shaft.material = this._material;
    shaft.isPickable = false;
    shaft.parent = root;
    // Parented to a TransformNode whose position changes after build —
    // the cached child bounds can fall outside the frustum at certain
    // angles. Same fix as mark_atom halo.
    shaft.alwaysSelectAsActiveMesh = true;

    // Cone: sits on top of the shaft
    const cone = MeshBuilder.CreateCylinder(
      `${this.id}_cone`,
      {
        height: headLen,
        diameterTop: 0,
        diameterBottom: coneRadius * 2,
        tessellation: 8,
        cap: Mesh.CAP_ALL,
      },
      this._scene,
    );
    cone.position = new Vector3(0, shaftLen + headLen / 2, 0);
    cone.material = this._material;
    cone.isPickable = false;
    cone.parent = root;
    cone.alwaysSelectAsActiveMesh = true;

    // Apply opacity directly on material
    this._material.alpha = opacity;

    // Orient root to point from → to
    root.rotationQuaternion = quaternionFromYToDir(dir);

    return root;
  }

  private _rebuildMeshes(): void {
    for (const m of this._root.getChildMeshes()) m.dispose();
    this._root.dispose();

    // Rebuild material in case color/opacity changed
    this._material.dispose();
    this._material = this._buildMaterial();

    this._root = this._buildMeshes();
  }
}

function resolveDefaults(p: Arrow3DProps): Required<Arrow3DProps> {
  const shaftRadius = p.shaftRadius ?? DEFAULT_SHAFT_RADIUS;
  return {
    from: p.from,
    to: p.to,
    color: p.color ?? DEFAULT_COLOR,
    opacity: p.opacity ?? DEFAULT_OPACITY,
    shaftRadius,
    headRatio: p.headRatio ?? DEFAULT_HEAD_RATIO,
    headRadius: p.headRadius ?? shaftRadius * 3,
    name: p.name ?? "",
  };
}

export type { Arrow3DProps, Vec3 };
