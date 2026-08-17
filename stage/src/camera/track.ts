import { interpolatePose } from "./interpolate";
import type { CameraPose, Vec3 } from "./pose";

/**
 * A camera trajectory: a function from normalized time `t in [0,1]` to a
 * {@link CameraPose}. This single-method contract is the extension point —
 * `TurntableTrack` (analytic) and {@link KeyframeTrack} (spline) share it
 * so the animator needs no changes.
 */
export interface CameraTrack {
  /** Total play duration, in seconds. */
  readonly duration: number;
  /** Whether playback wraps (`t` modulo 1) or clamps at the end. */
  readonly loop: boolean;
  /** Sample the pose at normalized time `t in [0,1]`. */
  sample(t: number): CameraPose;
}

/** One knot on a {@link KeyframeTrack}, with normalized time stamp. */
export interface CameraKeyframe {
  /** Normalized time in [0, 1]. Keys must be strictly increasing. */
  readonly t: number;
  readonly pose: CameraPose;
}

const DEFAULT_REVOLUTIONS = 1;
/** Polar angle from +Z (the orbit axis), matching `fit`'s elevated view. */
const DEFAULT_POLAR_ANGLE = Math.PI / 3;
const DEFAULT_UP: Vec3 = [0, 0, 1];

/** Configuration for an analytic turntable orbit (Z-up). */
export interface TurntableConfig {
  /** Orbit center (look-at target), in Å. */
  center: Vec3;
  /** Orbit radius, in Å. */
  radius: number;
  /** Total play duration, in seconds. */
  duration: number;
  /** Whole turns completed over the duration. Default 1. */
  revolutions?: number;
  /** Polar angle from +Z, in radians (elevation of the orbit). Default π/3. */
  polarAngle?: number;
  /** World up vector. Default [0,0,1]. */
  up?: Vec3;
  /** Optional fixed field of view, in radians. Omit to inherit the camera's. */
  fov?: number;
  /** Whether playback loops. Default true. */
  loop?: boolean;
}

/**
 * Analytic turntable: the camera orbits a circle of fixed `radius` around
 * `center` at a fixed polar elevation, completing `revolutions` whole turns
 * over `duration`. `sample(t)` computes the circle point directly:
 *
 *   theta = 2*PI*revolutions*t
 *   position = center + radius * (sinφ·cosθ, sinφ·sinθ, cosφ)   (φ = polarAngle)
 *
 * Computing the point analytically (rather than lerping between keyframes)
 * guarantees `|position - center| == radius` for EVERY `t` — a keyframe-lerp
 * would draw chords that dip inside the circle and clip the molecule.
 */
export class TurntableTrack implements CameraTrack {
  readonly duration: number;
  readonly loop: boolean;
  private readonly center: Vec3;
  private readonly radius: number;
  private readonly revolutions: number;
  private readonly polarAngle: number;
  private readonly up: Vec3;
  private readonly fov?: number;

  constructor(config: TurntableConfig) {
    this.center = config.center;
    this.radius = config.radius;
    this.duration = config.duration;
    this.revolutions = config.revolutions ?? DEFAULT_REVOLUTIONS;
    this.polarAngle = config.polarAngle ?? DEFAULT_POLAR_ANGLE;
    this.up = config.up ?? DEFAULT_UP;
    this.fov = config.fov;
    this.loop = config.loop ?? true;
  }

  sample(t: number): CameraPose {
    const theta = 2 * Math.PI * this.revolutions * t;
    const sinPolar = Math.sin(this.polarAngle);
    const cosPolar = Math.cos(this.polarAngle);
    const [cx, cy, cz] = this.center;
    const position: Vec3 = [
      cx + this.radius * sinPolar * Math.cos(theta),
      cy + this.radius * sinPolar * Math.sin(theta),
      cz + this.radius * cosPolar,
    ];
    return { position, target: this.center, up: this.up, fov: this.fov };
  }
}

export interface KeyframeTrackConfig {
  /** Ordered keyframes; at least two required. Times must be in [0,1] ascending. */
  keyframes: readonly CameraKeyframe[];
  /** Total play duration, in seconds. */
  duration: number;
  /** Whether playback loops. Default false. */
  loop?: boolean;
}

/**
 * Spline camera path through author-supplied keyframes.
 *
 * Between consecutive keys `i` and `i+1`, position is Catmull–Rom using
 * neighbors `i-1` / `i+2` (endpoints clamp), target lerps, up slerps when
 * both sides define it. Sample times outside the first/last key clamp.
 */
export class KeyframeTrack implements CameraTrack {
  readonly duration: number;
  readonly loop: boolean;
  private readonly keys: readonly CameraKeyframe[];

  constructor(config: KeyframeTrackConfig) {
    if (config.keyframes.length < 2) {
      throw new Error("KeyframeTrack requires at least two keyframes");
    }
    let prevT = -Infinity;
    for (const k of config.keyframes) {
      if (!(k.t >= 0 && k.t <= 1)) {
        throw new Error(`Keyframe t=${k.t} out of [0,1]`);
      }
      if (k.t <= prevT) {
        throw new Error("Keyframe times must be strictly increasing");
      }
      prevT = k.t;
    }
    this.keys = config.keyframes;
    this.duration = config.duration;
    this.loop = config.loop ?? false;
  }

  sample(t: number): CameraPose {
    let u = t;
    if (this.loop) {
      u = ((u % 1) + 1) % 1;
    } else {
      u = Math.min(1, Math.max(0, u));
    }

    const keys = this.keys;
    if (u <= keys[0].t) return keys[0].pose;
    if (u >= keys[keys.length - 1].t) return keys[keys.length - 1].pose;

    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t < u) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const span = b.t - a.t;
    const local = span > 0 ? (u - a.t) / span : 0;
    const beforeA = keys[Math.max(0, i - 1)].pose;
    const afterB = keys[Math.min(keys.length - 1, i + 2)].pose;
    return interpolatePose(a.pose, b.pose, local, {
      beforeA,
      afterB,
    });
  }
}
