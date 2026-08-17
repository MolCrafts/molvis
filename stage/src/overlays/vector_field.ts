/**
 * VectorFieldOverlay — renders N arrows as a batch using BabylonJS thin instances.
 *
 * Uses two base meshes (shaft cylinder + head cone) with thin instance buffers
 * for GPU-efficient rendering of large vector fields (e.g. atomic forces).
 */

import type { Scene } from "@babylonjs/core";
import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { Overlay, VectorFieldProps } from "./types";

const DEFAULT_COLOR = "#4488ff";
const DEFAULT_SHAFT_RADIUS = 0.03;
const DEFAULT_HEAD_RATIO = 0.25;
const DEFAULT_SCALE = 1;
const DEFAULT_MAX_ARROWS = 5000;

let _counter = 0;
function nextId(): string {
  return `vfield_${++_counter}`;
}

function hexToColor3(hex: string): Color3 {
  const h = hex.replace(/^#/, "");
  const r = Number.parseInt(h.substring(0, 2), 16) / 255;
  const g = Number.parseInt(h.substring(2, 4), 16) / 255;
  const b = Number.parseInt(h.substring(4, 6), 16) / 255;
  return new Color3(r, g, b);
}

function quaternionFromYToDir(dir: Vector3): Quaternion {
  const len = dir.length();
  if (len < 1e-10) return Quaternion.Identity();
  const n = dir.scale(1 / len);
  const dot = Vector3.Dot(Vector3.Up(), n);
  if (dot > 0.9999) return Quaternion.Identity();
  if (dot < -0.9999) return Quaternion.RotationAxis(Vector3.Right(), Math.PI);
  const axis = Vector3.Cross(Vector3.Up(), n).normalize();
  return Quaternion.RotationAxis(
    axis,
    Math.acos(Math.max(-1, Math.min(1, dot))),
  );
}

/**
 * Map a magnitude in [0, maxMag] to a color via a simple blue→green→red ramp.
 */
function magnitudeColor(mag: number, maxMag: number): Color3 {
  if (maxMag < 1e-10) return new Color3(0.27, 0.53, 1);
  const t = Math.min(1, mag / maxMag);
  // blue (0,0,1) → green (0,1,0) → red (1,0,0)
  if (t < 0.5) {
    const s = t * 2;
    return new Color3(0, s, 1 - s);
  }
  const s = (t - 0.5) * 2;
  return new Color3(s, 1 - s, 0);
}

export class VectorFieldOverlay implements Overlay {
  readonly id: string;
  readonly type = "vector_field" as const;

  private _props: Required<VectorFieldProps>;
  private _scene: Scene;
  private _shaftMesh: Mesh | null = null;
  private _coneMesh: Mesh | null = null;
  private _shaftMat: StandardMaterial;
  private _coneMat: StandardMaterial;
  private _visible = true;

  private constructor(
    id: string,
    props: Required<VectorFieldProps>,
    scene: Scene,
  ) {
    this.id = id;
    this._props = props;
    this._scene = scene;
    this._shaftMat = this._buildMaterial(`${id}_shaft_mat`);
    this._coneMat = this._buildMaterial(`${id}_cone_mat`);
    this._build();
  }

  static create(scene: Scene, props: VectorFieldProps): VectorFieldOverlay {
    return new VectorFieldOverlay(nextId(), resolveDefaults(props), scene);
  }

  get props(): Readonly<Required<VectorFieldProps>> {
    return this._props;
  }

  get visible(): boolean {
    return this._visible;
  }

  set visible(v: boolean) {
    this._visible = v;
    if (this._shaftMesh) this._shaftMesh.setEnabled(v);
    if (this._coneMesh) this._coneMesh.setEnabled(v);
  }

  update(patch: Partial<VectorFieldProps>): this {
    this._props = resolveDefaults({ ...this._props, ...patch });
    this._disposeMeshes();
    this._build();
    return this;
  }

  dispose(): void {
    this._disposeMeshes();
    this._shaftMat.dispose();
    this._coneMat.dispose();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _buildMaterial(name: string): StandardMaterial {
    const mat = new StandardMaterial(name, this._scene);
    const c = hexToColor3(this._props.color);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(0.4);
    return mat;
  }

  private _disposeMeshes(): void {
    if (this._shaftMesh) {
      this._shaftMesh.dispose();
      this._shaftMesh = null;
    }
    if (this._coneMesh) {
      this._coneMesh.dispose();
      this._coneMesh = null;
    }
  }

  private _build(): void {
    const {
      positions,
      vectors,
      scale,
      maxArrows,
      shaftRadius,
      headRatio,
      colorMode,
      color,
    } = this._props;

    const n = Math.min(positions.length / 3, vectors.length / 3, maxArrows);
    if (n === 0) return;

    // Pre-compute max magnitude for color mapping
    let maxMag = 0;
    if (colorMode === "magnitude") {
      for (let i = 0; i < n; i++) {
        const vx = vectors[i * 3];
        const vy = vectors[i * 3 + 1];
        const vz = vectors[i * 3 + 2];
        const mag = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (mag > maxMag) maxMag = mag;
      }
    }

    const uniformColor = hexToColor3(color);

    // Base meshes (1 instance to start, will be replaced by thin instances)
    const shaftBase = MeshBuilder.CreateCylinder(
      `${this.id}_shaft_base`,
      {
        height: 1,
        diameter: shaftRadius * 2,
        tessellation: 6,
        cap: Mesh.NO_CAP,
      },
      this._scene,
    );
    shaftBase.material = this._shaftMat;
    shaftBase.isPickable = false;

    const coneBase = MeshBuilder.CreateCylinder(
      `${this.id}_cone_base`,
      {
        height: 1,
        diameterTop: 0,
        diameterBottom: shaftRadius * 6,
        tessellation: 6,
        cap: Mesh.CAP_ALL,
      },
      this._scene,
    );
    coneBase.material = this._coneMat;
    coneBase.isPickable = false;

    // Build thin instance matrices + colors
    const shaftMatrices = new Float32Array(n * 16);
    const coneMatrices = new Float32Array(n * 16);
    const shaftColors = new Float32Array(n * 4);
    const coneColors = new Float32Array(n * 4);

    const pos = new Vector3();
    const vecV = new Vector3();
    const _translation = new Vector3();
    const matBuf = new Matrix();

    for (let i = 0; i < n; i++) {
      pos.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      vecV.set(vectors[i * 3], vectors[i * 3 + 1], vectors[i * 3 + 2]);

      const mag = vecV.length();
      const totalLen = mag * scale;
      if (totalLen < 1e-10) {
        // Zero-length arrow: place off-screen, skip
        Matrix.IdentityToRef(matBuf);
        const mat = matBuf.asArray();
        if (mat) {
          mat[15] = 0;
        }
        matBuf.copyToArray(shaftMatrices, i * 16);
        matBuf.copyToArray(coneMatrices, i * 16);
        shaftColors.fill(0, i * 4, i * 4 + 4);
        coneColors.fill(0, i * 4, i * 4 + 4);
        continue;
      }

      const headLen = totalLen * headRatio;
      const shaftLen = totalLen - headLen;
      const quat = quaternionFromYToDir(vecV);

      // Shaft: scale Y to shaftLen, translate to shaft center in local space,
      // then rotate + translate to world position.
      // We express this as: T_world * R * T_local * Scale
      const shaftScale = new Vector3(1, shaftLen, 1);
      const shaftLocalCenter = new Vector3(0, shaftLen / 2, 0);
      // Rotate local center into world space
      Matrix.FromQuaternionToRef(quat, matBuf);
      const shaftWorldCenter = pos.add(
        Vector3.TransformCoordinates(shaftLocalCenter, matBuf),
      );

      Matrix.ComposeToRef(shaftScale, quat, shaftWorldCenter, matBuf);
      matBuf.copyToArray(shaftMatrices, i * 16);

      // Cone: scale Y to headLen, local center at (0, headLen/2, 0)
      const coneScale = new Vector3(1, headLen, 1);
      const coneLocalBase = new Vector3(0, shaftLen + headLen / 2, 0);
      Matrix.FromQuaternionToRef(quat, matBuf);
      const coneWorldCenter = pos.add(
        Vector3.TransformCoordinates(coneLocalBase, matBuf),
      );

      Matrix.ComposeToRef(coneScale, quat, coneWorldCenter, matBuf);
      matBuf.copyToArray(coneMatrices, i * 16);

      // Colors
      let c: Color3;
      if (colorMode === "magnitude") {
        c = magnitudeColor(mag, maxMag);
      } else if (colorMode === "direction") {
        // Map direction vector components to RGB (normalized 0..1)
        const nd = vecV.scale(1 / mag);
        c = new Color3((nd.x + 1) / 2, (nd.y + 1) / 2, (nd.z + 1) / 2);
      } else {
        c = uniformColor;
      }

      shaftColors[i * 4] = c.r;
      shaftColors[i * 4 + 1] = c.g;
      shaftColors[i * 4 + 2] = c.b;
      shaftColors[i * 4 + 3] = 1;

      coneColors[i * 4] = c.r;
      coneColors[i * 4 + 1] = c.g;
      coneColors[i * 4 + 2] = c.b;
      coneColors[i * 4 + 3] = 1;
    }

    shaftBase.thinInstanceSetBuffer("matrix", shaftMatrices, 16);
    shaftBase.thinInstanceSetBuffer("color", shaftColors, 4);
    coneBase.thinInstanceSetBuffer("matrix", coneMatrices, 16);
    coneBase.thinInstanceSetBuffer("color", coneColors, 4);

    this._shaftMesh = shaftBase;
    this._coneMesh = coneBase;

    if (!this._visible) {
      shaftBase.setEnabled(false);
      coneBase.setEnabled(false);
    }
  }
}

function resolveDefaults(p: VectorFieldProps): Required<VectorFieldProps> {
  const shaftRadius = p.shaftRadius ?? DEFAULT_SHAFT_RADIUS;
  return {
    positions: p.positions,
    vectors: p.vectors,
    scale: p.scale ?? DEFAULT_SCALE,
    colorMode: p.colorMode ?? "magnitude",
    color: p.color ?? DEFAULT_COLOR,
    maxArrows: p.maxArrows ?? DEFAULT_MAX_ARROWS,
    shaftRadius,
    headRatio: p.headRatio ?? DEFAULT_HEAD_RATIO,
    name: p.name ?? "",
  };
}
