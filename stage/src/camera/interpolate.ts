import type { CameraPose, Vec3 } from "./pose";

/**
 * Cubic Catmull–Rom spline through four control points at local
 * parameter `t ∈ [0, 1]` between p1 and p2.
 */
export function catmullRomVec3(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  t: number,
): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const v0 = p0[i];
    const v1 = p1[i];
    const v2 = p2[i];
    const v3 = p3[i];
    out[i] =
      0.5 *
      (2 * v1 +
        (-v0 + v2) * t +
        (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
        (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
  }
  return out;
}

/** Component-wise linear interpolation. */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Spherical linear interpolation for unit-ish direction vectors. */
export function slerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  const dotRaw = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const dot = Math.min(1, Math.max(-1, dotRaw));
  // Nearly parallel — fall back to lerp + renormalize.
  if (dot > 0.9995) {
    const l = lerpVec3(a, b, t);
    return normalize(l);
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const w0 = Math.sin((1 - t) * theta) / sinTheta;
  const w1 = Math.sin(t * theta) / sinTheta;
  return normalize([
    a[0] * w0 + b[0] * w1,
    a[1] * w0 + b[1] * w1,
    a[2] * w0 + b[2] * w1,
  ]);
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Interpolate two poses. Position uses Catmull–Rom when neighbor
 * poses are supplied; otherwise linear. Target lerps; up slerps when
 * both defined.
 */
export function interpolatePose(
  a: CameraPose,
  b: CameraPose,
  t: number,
  neighbors?: { beforeA?: CameraPose; afterB?: CameraPose },
): CameraPose {
  const tt = Math.min(1, Math.max(0, t));
  let position: Vec3;
  if (neighbors?.beforeA && neighbors?.afterB) {
    position = catmullRomVec3(
      neighbors.beforeA.position,
      a.position,
      b.position,
      neighbors.afterB.position,
      tt,
    );
  } else {
    position = lerpVec3(a.position, b.position, tt);
  }
  const target = lerpVec3(a.target, b.target, tt);
  let up: Vec3 | undefined;
  if (a.up && b.up) {
    up = slerpVec3(a.up, b.up, tt);
  } else {
    up = a.up ?? b.up;
  }
  let fov: number | undefined;
  if (a.fov !== undefined && b.fov !== undefined) {
    fov = a.fov + (b.fov - a.fov) * tt;
  } else {
    fov = a.fov ?? b.fov;
  }
  return { position, target, up, fov };
}
