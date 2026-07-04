import {
  Color3,
  type LinesMesh,
  MeshBuilder,
  type Scene,
  Vector3,
} from "@babylonjs/core";
import type { Overlay, Vec3 } from "./types";

/**
 * Wireframe overlays for confinement *regions* — the geometric primitives a
 * packer (molpack) restrains atoms into or out of. Each molpack geometric
 * restraint family maps to one shape here; `Inside*` / `Outside*` /
 * `Above*` / `Below*` variants share the same wireframe (the shape is the
 * boundary, the variant only picks which side is penalized):
 *
 * | molpack restraint            | region kind |
 * |------------------------------|-------------|
 * | Inside/Outside Sphere        | `sphere`    |
 * | Inside/Outside Box, Cube     | `box`       |
 * | Inside/Outside Ellipsoid     | `ellipsoid` |
 * | Inside/Outside Cylinder      | `cylinder`  |
 * | Above/Below Plane            | `plane`     |
 * | Above/Below Gaussian         | `gaussian`  |
 *
 * Every shape is drawn as a single `LinesMesh` of polylines (sparse lat/long
 * nets, box edges, grid patches) so it reads like a matplotlib `plot_wireframe`
 * boundary rather than a solid surface.
 */

/** Shared styling for every region wireframe. */
export interface RegionStyle {
  /** CSS hex color string. Default: "#9aa0a6" (light gray). */
  color?: string;
  /** Opacity 0–1. Default: 0.5. */
  opacity?: number;
}

/** A sphere boundary — molpack Inside/OutsideSphere. */
export interface SphereRegion {
  kind: "sphere";
  /** World-space center. Default: [0, 0, 0]. */
  center?: Vec3;
  radius: number;
  /** Latitude rings (excl. poles). Default: 11. */
  latitudes?: number;
  /** Longitude meridians. Default: 18. */
  longitudes?: number;
  /** Points per ring. Default: 48. */
  segments?: number;
}

/** An axis-aligned ellipsoid — molpack Inside/OutsideEllipsoid. */
export interface EllipsoidRegion {
  kind: "ellipsoid";
  center?: Vec3;
  /** Per-axis semi-axes (rx, ry, rz). */
  radii: Vec3;
  latitudes?: number;
  longitudes?: number;
  segments?: number;
}

/** An axis-aligned box — molpack Inside/OutsideBox and Inside/OutsideCube. */
export interface BoxRegion {
  kind: "box";
  /** Lower corner. */
  min: Vec3;
  /** Upper corner. */
  max: Vec3;
}

/** A finite cylinder — molpack Inside/OutsideCylinder. */
export interface CylinderRegion {
  kind: "cylinder";
  /** Center of the cylinder axis. Default: [0, 0, 0]. */
  center?: Vec3;
  /** Axis direction (need not be unit). */
  axis: Vec3;
  radius: number;
  /** Total length along the axis. */
  length: number;
  /** Points per end circle. Default: 48. */
  segments?: number;
  /** Number of vertical struts joining the end circles. Default: 12. */
  struts?: number;
}

/**
 * A bounded patch of an infinite plane `normal · x = distance` — molpack
 * Above/BelowPlane. `normal` is normalized for placement; `size` sets the
 * drawn patch extent (the true restraint plane is infinite).
 */
export interface PlaneRegion {
  kind: "plane";
  normal: Vec3;
  distance: number;
  /** Side length of the drawn square patch (Å). Default: 20. */
  size?: number;
  /** Grid divisions per side. Default: 8. */
  divisions?: number;
}

/**
 * A Gaussian bump surface `z = z0 + height·exp(-((x-cx)²/2sx² + (y-cy)²/2sy²))`
 * — molpack Above/BelowGaussian. Drawn as a wireframe grid over ±`extent`·σ.
 */
export interface GaussianRegion {
  kind: "gaussian";
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  z0: number;
  height: number;
  /** Half-width of the drawn grid in units of σ. Default: 3. */
  extent?: number;
  /** Grid divisions per axis. Default: 24. */
  divisions?: number;
}

export type RegionShape =
  | SphereRegion
  | EllipsoidRegion
  | BoxRegion
  | CylinderRegion
  | PlaneRegion
  | GaussianRegion;

export type RegionWireframeSpec = RegionShape & RegionStyle;

/**
 * A single wireframe region overlay. Pure 3D world-space decoration — no
 * per-frame screen projection, so only {@link dispose} is implemented.
 */
export class RegionWireframeOverlay implements Overlay {
  readonly id: string;
  /** `"<kind>_wireframe"`, e.g. `"sphere_wireframe"`, `"box_wireframe"`. */
  readonly type: string;

  protected readonly _mesh: LinesMesh;

  constructor(id: string, spec: RegionWireframeSpec, scene: Scene) {
    this.id = id;
    this.type = `${spec.kind}_wireframe`;
    const lines = buildRegionLines(spec);
    this._mesh = MeshBuilder.CreateLineSystem(`${id}-lines`, { lines }, scene);
    this._mesh.color = Color3.FromHexString(spec.color ?? "#9aa0a6");
    this._mesh.alpha = spec.opacity ?? 0.5;
    this._mesh.isPickable = false;
  }

  get visible(): boolean {
    return this._mesh.isEnabled();
  }

  set visible(v: boolean) {
    this._mesh.setEnabled(v);
  }

  dispose(): void {
    this._mesh.dispose();
  }
}

/** Dispatch a region spec to its polyline builder. */
export function buildRegionLines(spec: RegionShape): Vector3[][] {
  switch (spec.kind) {
    case "sphere":
      return ellipsoidLines(
        spec.center ?? [0, 0, 0],
        [spec.radius, spec.radius, spec.radius],
        spec.latitudes ?? 11,
        spec.longitudes ?? 18,
        spec.segments ?? 48,
      );
    case "ellipsoid":
      return ellipsoidLines(
        spec.center ?? [0, 0, 0],
        spec.radii,
        spec.latitudes ?? 11,
        spec.longitudes ?? 18,
        spec.segments ?? 48,
      );
    case "box":
      return boxLines(spec.min, spec.max);
    case "cylinder":
      return cylinderLines(
        spec.center ?? [0, 0, 0],
        spec.axis,
        spec.radius,
        spec.length,
        spec.segments ?? 48,
        spec.struts ?? 12,
      );
    case "plane":
      return planeLines(
        spec.normal,
        spec.distance,
        spec.size ?? 20,
        spec.divisions ?? 8,
      );
    case "gaussian":
      return gaussianLines(spec);
  }
}

// ── Geometry builders ─────────────────────────────────────────────────────────

/** Latitude rings + longitude meridians of a (possibly anisotropic) ellipsoid. */
function ellipsoidLines(
  center: Vec3,
  radii: Vec3,
  latRings: number,
  lonRings: number,
  segments: number,
): Vector3[][] {
  const [cx, cy, cz] = center;
  const [rx, ry, rz] = radii;
  const lat = Math.max(2, latRings);
  const lon = Math.max(2, lonRings);
  const seg = Math.max(8, segments);
  const lines: Vector3[][] = [];

  for (let i = 1; i < lat; i++) {
    const theta = (Math.PI * i) / lat;
    const st = Math.sin(theta);
    const z = Math.cos(theta);
    const ring: Vector3[] = [];
    for (let s = 0; s <= seg; s++) {
      const phi = (2 * Math.PI * s) / seg;
      ring.push(
        new Vector3(
          cx + rx * st * Math.cos(phi),
          cy + ry * st * Math.sin(phi),
          cz + rz * z,
        ),
      );
    }
    lines.push(ring);
  }

  for (let j = 0; j < lon; j++) {
    const phi = (2 * Math.PI * j) / lon;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const meridian: Vector3[] = [];
    for (let s = 0; s <= seg; s++) {
      const theta = (Math.PI * s) / seg;
      const st = Math.sin(theta);
      meridian.push(
        new Vector3(
          cx + rx * st * cp,
          cy + ry * st * sp,
          cz + rz * Math.cos(theta),
        ),
      );
    }
    lines.push(meridian);
  }

  return lines;
}

/** The 12 edges of an axis-aligned box. */
function boxLines(min: Vec3, max: Vec3): Vector3[][] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const c = [
    new Vector3(x0, y0, z0),
    new Vector3(x1, y0, z0),
    new Vector3(x1, y1, z0),
    new Vector3(x0, y1, z0),
    new Vector3(x0, y0, z1),
    new Vector3(x1, y0, z1),
    new Vector3(x1, y1, z1),
    new Vector3(x0, y1, z1),
  ];
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0], // bottom
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4], // top
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7], // verticals
  ];
  return edges.map(([a, b]) => [c[a], c[b]]);
}

/** Two end circles plus axial struts of a finite cylinder. */
function cylinderLines(
  center: Vec3,
  axis: Vec3,
  radius: number,
  length: number,
  segments: number,
  struts: number,
): Vector3[][] {
  const c = new Vector3(center[0], center[1], center[2]);
  const w = new Vector3(axis[0], axis[1], axis[2]).normalize();
  const { u, v } = orthonormalBasis(w);
  const half = length / 2;
  const seg = Math.max(8, segments);
  const lines: Vector3[][] = [];

  const circleAt = (sign: number): Vector3[] => {
    const base = c.add(w.scale(sign * half));
    const ring: Vector3[] = [];
    for (let s = 0; s <= seg; s++) {
      const phi = (2 * Math.PI * s) / seg;
      ring.push(
        base
          .add(u.scale(radius * Math.cos(phi)))
          .add(v.scale(radius * Math.sin(phi))),
      );
    }
    return ring;
  };
  lines.push(circleAt(-1), circleAt(1));

  const n = Math.max(2, struts);
  for (let k = 0; k < n; k++) {
    const phi = (2 * Math.PI * k) / n;
    const radial = u
      .scale(radius * Math.cos(phi))
      .add(v.scale(radius * Math.sin(phi)));
    lines.push([
      c.add(w.scale(-half)).add(radial),
      c.add(w.scale(half)).add(radial),
    ]);
  }

  return lines;
}

/** A square grid patch of the plane `normal · x = distance`. */
function planeLines(
  normal: Vec3,
  distance: number,
  size: number,
  divisions: number,
): Vector3[][] {
  const n = new Vector3(normal[0], normal[1], normal[2]).normalize();
  const p0 = n.scale(distance);
  const { u, v } = orthonormalBasis(n);
  const half = size / 2;
  const div = Math.max(1, divisions);
  const lines: Vector3[][] = [];

  for (let i = 0; i <= div; i++) {
    const t = -half + (size * i) / div;
    // line varying along u at fixed v=t
    lines.push([
      p0.add(u.scale(-half)).add(v.scale(t)),
      p0.add(u.scale(half)).add(v.scale(t)),
    ]);
    // line varying along v at fixed u=t
    lines.push([
      p0.add(u.scale(t)).add(v.scale(-half)),
      p0.add(u.scale(t)).add(v.scale(half)),
    ]);
  }

  return lines;
}

/** A wireframe grid of a 2D Gaussian bump surface. */
function gaussianLines(g: GaussianRegion): Vector3[][] {
  const extent = g.extent ?? 3;
  const div = Math.max(2, g.divisions ?? 24);
  const x0 = g.cx - extent * g.sx;
  const x1 = g.cx + extent * g.sx;
  const y0 = g.cy - extent * g.sy;
  const y1 = g.cy + extent * g.sy;

  const z = (x: number, y: number): number =>
    g.z0 +
    g.height *
      Math.exp(
        -(
          (x - g.cx) ** 2 / (2 * g.sx ** 2) +
          (y - g.cy) ** 2 / (2 * g.sy ** 2)
        ),
      );

  const lines: Vector3[][] = [];
  for (let i = 0; i <= div; i++) {
    const y = y0 + ((y1 - y0) * i) / div;
    const row: Vector3[] = [];
    for (let j = 0; j <= div; j++) {
      const x = x0 + ((x1 - x0) * j) / div;
      row.push(new Vector3(x, y, z(x, y)));
    }
    lines.push(row);
  }
  for (let j = 0; j <= div; j++) {
    const x = x0 + ((x1 - x0) * j) / div;
    const col: Vector3[] = [];
    for (let i = 0; i <= div; i++) {
      const y = y0 + ((y1 - y0) * i) / div;
      col.push(new Vector3(x, y, z(x, y)));
    }
    lines.push(col);
  }
  return lines;
}

/** Build an orthonormal basis {u, v} spanning the plane perpendicular to `w`. */
function orthonormalBasis(w: Vector3): { u: Vector3; v: Vector3 } {
  // Pick a reference axis least parallel to w to avoid a degenerate cross.
  const ref = Math.abs(w.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const u = Vector3.Cross(w, ref).normalize();
  const v = Vector3.Cross(w, u).normalize();
  return { u, v };
}
