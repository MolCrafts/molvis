/**
 * World-space point markers (solid spheres) for cluster COM etc.
 */

import {
  Color3,
  type Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { Overlay, Vec3 } from "./types";

let _counter = 0;
function nextId(): string {
  return `points_${++_counter}`;
}

function hexToColor3(hex: string): Color3 {
  const h = hex.replace(/^#/, "");
  return new Color3(
    Number.parseInt(h.substring(0, 2), 16) / 255,
    Number.parseInt(h.substring(2, 4), 16) / 255,
    Number.parseInt(h.substring(4, 6), 16) / 255,
  );
}

export interface PointMarker {
  position: Vec3;
  /** CSS hex. Default inherits from props.color. */
  color?: string;
  radius?: number;
}

export interface PointMarkersProps {
  points: PointMarker[];
  /** Default color when a point omits color. */
  color?: string;
  /** Default sphere radius (Å). Default 0.35. */
  radius?: number;
  opacity?: number;
  name?: string;
}

export class PointMarkersOverlay implements Overlay {
  readonly id: string;
  readonly type = "point_markers" as const;
  private _meshes: Mesh[] = [];
  private _visible = true;
  private readonly _scene: Scene;

  private constructor(scene: Scene, props: PointMarkersProps) {
    this.id = nextId();
    this._scene = scene;
    this.rebuild(props);
  }

  static create(scene: Scene, props: PointMarkersProps): PointMarkersOverlay {
    return new PointMarkersOverlay(scene, props);
  }

  update(props: PointMarkersProps): void {
    this.rebuild(props);
  }

  private rebuild(props: PointMarkersProps): void {
    this._disposeMeshes();
    const defaultColor = props.color ?? "#ff6644";
    const defaultR = props.radius ?? 0.35;
    const opacity = props.opacity ?? 0.95;
    const name = props.name ?? "PointMarkers";

    for (let i = 0; i < props.points.length; i++) {
      const p = props.points[i];
      const r = p.radius ?? defaultR;
      const mesh = MeshBuilder.CreateSphere(
        `${this.id}_${name}_${i}`,
        { diameter: r * 2, segments: 12 },
        this._scene,
      );
      mesh.position = new Vector3(p.position[0], p.position[1], p.position[2]);
      mesh.isPickable = false;
      const mat = new StandardMaterial(`${this.id}_mat_${i}`, this._scene);
      mat.disableLighting = true;
      mat.emissiveColor = hexToColor3(p.color ?? defaultColor);
      mat.alpha = opacity;
      mesh.material = mat;
      mesh.setEnabled(this._visible);
      this._meshes.push(mesh);
    }
  }

  get visible(): boolean {
    return this._visible;
  }

  set visible(v: boolean) {
    this._visible = v;
    for (const m of this._meshes) m.setEnabled(v);
  }

  dispose(): void {
    this._disposeMeshes();
  }

  private _disposeMeshes(): void {
    for (const m of this._meshes) {
      m.material?.dispose();
      m.dispose();
    }
    this._meshes = [];
  }
}
