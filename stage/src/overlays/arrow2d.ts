/**
 * Arrow2DOverlay — a flat, 2D-style arrow in world space.
 *
 * Unlike Arrow3D (which has cylindrical volume), Arrow2D is rendered using
 * BabylonJS line meshes (CreateLines), giving it a flat/diagram look.
 * Because the lines exist in world space (not DOM/screen space), they
 * follow camera orbit/pan/zoom naturally — no per-frame projection needed.
 *
 * The `billboard` option (default: false) makes the arrow always face the
 * camera, useful for plan-view or diagram-style annotations.
 */

import type { Scene } from "@babylonjs/core";
import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  Quaternion,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { Arrow2DProps, Overlay } from "./types";

const DEFAULT_COLOR = "#44aaff";
const DEFAULT_STROKE_WIDTH = 0.03;
const DEFAULT_HEAD_SIZE = 4;

let _counter = 0;
function nextId(): string {
  return `arrow2d_${++_counter}`;
}

function hexToColor4(hex: string, alpha = 1): Color4 {
  const h = hex.replace(/^#/, "");
  const r = Number.parseInt(h.substring(0, 2), 16) / 255;
  const g = Number.parseInt(h.substring(2, 4), 16) / 255;
  const b = Number.parseInt(h.substring(4, 6), 16) / 255;
  return new Color4(r, g, b, alpha);
}

function _hexToColor3(hex: string): Color3 {
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

export class Arrow2DOverlay implements Overlay {
  readonly id: string;
  readonly type = "arrow2d" as const;

  private _props: Required<Arrow2DProps>;
  private _scene: Scene;
  private _root: TransformNode | null = null;

  private constructor(id: string, props: Required<Arrow2DProps>, scene: Scene) {
    this.id = id;
    this._props = props;
    this._scene = scene;
    this._build();
  }

  static create(scene: Scene, props: Arrow2DProps): Arrow2DOverlay {
    return new Arrow2DOverlay(nextId(), resolveDefaults(props), scene);
  }

  get props(): Readonly<Required<Arrow2DProps>> {
    return this._props;
  }

  get visible(): boolean {
    return this._root?.isEnabled() ?? true;
  }

  set visible(v: boolean) {
    this._root?.setEnabled(v);
  }

  update(patch: Partial<Arrow2DProps>): this {
    this._props = resolveDefaults({ ...this._props, ...patch });
    this._dispose();
    this._build();
    return this;
  }

  dispose(): void {
    this._dispose();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _dispose(): void {
    if (this._root) {
      for (const m of this._root.getChildMeshes()) m.dispose();
      this._root.dispose();
      this._root = null;
    }
  }

  private _build(): void {
    const { from, to, color, strokeWidth, headSize, dashed, billboard } =
      this._props;

    const fromVec = new Vector3(from[0], from[1], from[2]);
    const toVec = new Vector3(to[0], to[1], to[2]);
    const dir = toVec.subtract(fromVec);
    const totalLen = dir.length();

    const root = new TransformNode(`${this.id}_root`, this._scene);

    if (totalLen < 1e-10) {
      this._root = root;
      return;
    }

    if (billboard) {
      root.billboardMode = Mesh.BILLBOARDMODE_ALL;
    }

    const col4 = hexToColor4(color);
    const headLen = strokeWidth * headSize;

    // ── Shaft ────────────────────────────────────────────────────────────────
    if (dashed) {
      const dashLen = strokeWidth * 3;
      const gapLen = strokeWidth * 2;
      const shaftLen = totalLen - headLen;
      let cursor = 0;
      let segIdx = 0;
      while (cursor < shaftLen - dashLen) {
        const segStart = new Vector3(0, cursor, 0);
        const segEnd = new Vector3(0, Math.min(cursor + dashLen, shaftLen), 0);
        const dash = MeshBuilder.CreateLines(
          `${this.id}_dash_${segIdx++}`,
          { points: [segStart, segEnd], colors: [col4, col4] },
          this._scene,
        );
        dash.isPickable = false;
        dash.parent = root;
        cursor += dashLen + gapLen;
      }
    } else {
      const shaftEnd = new Vector3(0, totalLen - headLen, 0);
      const shaft = MeshBuilder.CreateLines(
        `${this.id}_shaft`,
        {
          points: [Vector3.Zero(), shaftEnd],
          colors: [col4, col4],
        },
        this._scene,
      );
      shaft.isPickable = false;
      shaft.parent = root;
    }

    // ── Arrowhead (triangle lines) ───────────────────────────────────────────
    const tipY = totalLen;
    const baseY = totalLen - headLen;
    const halfBase = (strokeWidth * headSize) / 2;

    const tip = new Vector3(0, tipY, 0);
    const leftWing = new Vector3(-halfBase, baseY, 0);
    const rightWing = new Vector3(halfBase, baseY, 0);

    const head = MeshBuilder.CreateLines(
      `${this.id}_head`,
      {
        points: [leftWing, tip, rightWing],
        colors: [col4, col4, col4],
      },
      this._scene,
    );
    head.isPickable = false;
    head.parent = root;

    // Orient root from → to
    root.position = fromVec.clone();
    root.rotationQuaternion = quaternionFromYToDir(dir);

    this._root = root;
  }
}

function resolveDefaults(p: Arrow2DProps): Required<Arrow2DProps> {
  return {
    from: p.from,
    to: p.to,
    color: p.color ?? DEFAULT_COLOR,
    strokeWidth: p.strokeWidth ?? DEFAULT_STROKE_WIDTH,
    headSize: p.headSize ?? DEFAULT_HEAD_SIZE,
    dashed: p.dashed ?? false,
    billboard: p.billboard ?? false,
    name: p.name ?? "",
  };
}
