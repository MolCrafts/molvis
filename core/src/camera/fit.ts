import { Vector3 } from "@babylonjs/core";
import type { Obb } from "./obb";
import type { Vec3 } from "./pose";

/** An axis-aligned bounding box, structurally compatible with `SceneIndex.getBounds()`. */
export interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** The camera framing for a bounding box: where to look and how far back to sit. */
export interface ViewFit {
  center: Vector3;
  /** Distance from center needed to frame the box, in Å. */
  radius: number;
}

/** Padding factor applied so the scene does not touch the viewport edges. */
export const FIT_PADDING = 1.2;
/** Floor on the framing distance, so tiny/degenerate scenes stay viewable. */
export const FIT_MIN_DISTANCE = 5.0;

/**
 * Wrap an axis-aligned {@link Bounds} as a world-axis {@link Obb} so it can be
 * framed by {@link fitBoxToView}. Used where only an AABB is available (e.g. the
 * turntable orbit) — the box is already axis-aligned, so no PCA is needed.
 */
export function aabbToObb(bounds: Bounds): Obb {
  return {
    center: [
      (bounds.min.x + bounds.max.x) * 0.5,
      (bounds.min.y + bounds.max.y) * 0.5,
      (bounds.min.z + bounds.max.z) * 0.5,
    ],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfExtents: [
      (bounds.max.x - bounds.min.x) * 0.5,
      (bounds.max.y - bounds.min.y) * 0.5,
      (bounds.max.z - bounds.min.z) * 0.5,
    ],
    degenerate: false,
  };
}

/** Default azimuth (α) for the reset/"iso" view — 45° in the XY plane. Matches `World`. */
export const ISO_ALPHA = Math.PI / 4;
/** Default polar angle (β) for the reset/"iso" view — viewed from the (a,a,a) direction. */
export const ISO_BETA = Math.PI / 3;

/** A camera screen basis in world space (all unit, mutually orthogonal). */
export interface ViewBasis {
  /** Camera-to-target direction. */
  forward: Vec3;
  /** Screen-right (world space). */
  right: Vec3;
  /** Screen-up (world space). */
  up: Vec3;
}

/** Azimuth/polar angles for an `ArcRotateCamera` (Z-up). */
export interface ViewAngles {
  alpha: number;
  beta: number;
}

/** Options for {@link fitBoxToView}. */
export interface ViewFitOptions {
  /** Padding factor (default {@link FIT_PADDING}). */
  padding?: number;
  /** Floor on the framing distance (default {@link FIT_MIN_DISTANCE}). */
  minDistance?: number;
  /**
   * `"iso"` (default) keeps the stable {@link ISO_ALPHA}/{@link ISO_BETA} view;
   * `"auto"` looks down the OBB's minor axis to maximize the projected
   * silhouette.
   */
  viewDirection?: "iso" | "auto";
}

/** A {@link ViewFit} plus the view direction it was framed for (when computed). */
export interface BoxFit extends ViewFit {
  /** The α/β the framing assumes; consumers should set these on the camera. */
  direction: ViewAngles;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-12 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
}

function absDot(a: Vec3, b: Vec3): number {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

/**
 * Screen basis (right/up/forward) of a Z-up `ArcRotateCamera` at the given
 * angles. The camera sits at `target + radius·dir` with
 * `dir = (sinβcosα, sinβsinα, cosβ)`; `forward = -dir`. When `forward` is
 * (anti)parallel to world-up the right vector is derived from the Y axis to
 * stay finite.
 */
export function viewBasis(alpha: number, beta: number): ViewBasis {
  const dir: Vec3 = [
    Math.sin(beta) * Math.cos(alpha),
    Math.sin(beta) * Math.sin(alpha),
    Math.cos(beta),
  ];
  const forward: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const worldUp: Vec3 =
    absDot(forward, [0, 0, 1]) > 0.9999 ? [0, 1, 0] : [0, 0, 1];
  const right = normalize(cross(forward, worldUp));
  const up = normalize(cross(right, forward));
  return { forward, right, up };
}

/** Inverse of {@link viewBasis}: α/β whose camera looks along `forward`. */
export function anglesFromForward(forward: Vec3): ViewAngles {
  const dir: Vec3 = [-forward[0], -forward[1], -forward[2]];
  const beta = Math.acos(Math.min(1, Math.max(-1, dir[2])));
  const alpha = Math.atan2(dir[1], dir[0]);
  return { alpha, beta };
}

/**
 * Frame an {@link Obb} exactly for the chosen view direction.
 *
 * Projects the radius-expanded box extents onto the camera's screen axes and
 * fits each axis to its field of view (vertical to `fov`, horizontal to the
 * aspect-widened `fov`), taking the larger required distance. This is
 * radius-aware (extents already include radii), per-axis (wide viewports
 * tighten), and orientation-correct (no corner clips). `"auto"` looks down the
 * minor axis so flat/elongated structures present their largest silhouette.
 *
 * @param fov Vertical field of view, in radians.
 * @param aspectRatio Viewport width / height.
 */
export function fitBoxToView(
  obb: Obb,
  fov: number,
  aspectRatio: number,
  options?: ViewFitOptions,
): BoxFit {
  const padding = options?.padding ?? FIT_PADDING;
  const minDistance = options?.minDistance ?? FIT_MIN_DISTANCE;
  const mode = options?.viewDirection ?? "iso";

  // Auto-view needs a well-defined minor axis; a degenerate OBB falls back to
  // the stable iso angles so the framing basis matches pickViewDirection.
  const useAuto = mode === "auto" && !obb.degenerate;
  const direction: ViewAngles = useAuto
    ? anglesFromForward([-obb.axes[2][0], -obb.axes[2][1], -obb.axes[2][2]])
    : { alpha: ISO_ALPHA, beta: ISO_BETA };

  const basis = viewBasis(direction.alpha, direction.beta);

  // Screen half-extents = sum of |extent · screen-axis| over the OBB axes.
  let halfW = 0;
  let halfH = 0;
  for (let k = 0; k < 3; k++) {
    halfW += obb.halfExtents[k] * absDot(obb.axes[k], basis.right);
    halfH += obb.halfExtents[k] * absDot(obb.axes[k], basis.up);
  }

  const tanV = Math.tan(fov / 2);
  const tanH = aspectRatio * tanV;
  let distance = Math.max(halfH / tanV, halfW / tanH);
  distance *= padding;
  distance = Math.max(distance, minDistance);

  return {
    center: new Vector3(obb.center[0], obb.center[1], obb.center[2]),
    radius: distance,
    direction,
  };
}
