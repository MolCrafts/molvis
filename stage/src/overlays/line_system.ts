/**
 * Generic line-system overlay for polyhedra / trajectory paths.
 */

import type { Scene } from "@babylonjs/core";
import {
  Color3,
  Color4,
  type LinesMesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { Overlay } from "./types";

let _counter = 0;
function nextId(): string {
  return `lines_${++_counter}`;
}

function hexToColor3(hex: string): Color3 {
  const h = hex.replace(/^#/, "");
  return new Color3(
    Number.parseInt(h.substring(0, 2), 16) / 255,
    Number.parseInt(h.substring(2, 4), 16) / 255,
    Number.parseInt(h.substring(4, 6), 16) / 255,
  );
}

export interface LineSystemProps {
  /** Each entry is a polyline of points. */
  lines: Array<Array<{ x: number; y: number; z: number }>>;
  color?: string;
  opacity?: number;
  name?: string;
}

export class LineSystemOverlay implements Overlay {
  readonly id: string;
  readonly type = "line_system" as const;
  private _mesh: LinesMesh | null = null;
  private _mat: StandardMaterial;
  private _visible = true;
  private _scene: Scene;

  private constructor(scene: Scene, props: LineSystemProps) {
    this.id = nextId();
    this._scene = scene;
    this._mat = new StandardMaterial(`${this.id}_mat`, scene);
    this._mat.disableLighting = true;
    this._mat.emissiveColor = hexToColor3(props.color ?? "#66ccff");
    this._mat.alpha = props.opacity ?? 0.9;
    this.rebuild(props.lines, props.name ?? "LineSystem");
  }

  static create(scene: Scene, props: LineSystemProps): LineSystemOverlay {
    return new LineSystemOverlay(scene, props);
  }

  update(props: Partial<LineSystemProps>): void {
    if (props.color) this._mat.emissiveColor = hexToColor3(props.color);
    if (props.opacity !== undefined) this._mat.alpha = props.opacity;
    if (props.lines) this.rebuild(props.lines, props.name ?? "LineSystem");
  }

  private rebuild(
    lines: Array<Array<{ x: number; y: number; z: number }>>,
    name: string,
  ): void {
    this._mesh?.dispose();
    this._mesh = null;
    if (lines.length === 0) return;
    const paths = lines.map((poly) =>
      poly.map((p) => new Vector3(p.x, p.y, p.z)),
    );
    const mesh = MeshBuilder.CreateLineSystem(
      `${this.id}_${name}`,
      {
        lines: paths,
        updatable: false,
        colors: paths.map((poly) =>
          poly.map(() => {
            const c = this._mat.emissiveColor;
            return new Color4(c.r, c.g, c.b, this._mat.alpha);
          }),
        ),
      },
      this._scene,
    );
    mesh.material = this._mat;
    mesh.isPickable = false;
    mesh.visibility = this._visible ? 1 : 0;
    this._mesh = mesh;
  }

  get visible(): boolean {
    return this._visible;
  }
  set visible(v: boolean) {
    this._visible = v;
    if (this._mesh) this._mesh.visibility = v ? 1 : 0;
  }

  dispose(): void {
    this._mesh?.dispose();
    this._mesh = null;
    this._mat.dispose();
  }
}
