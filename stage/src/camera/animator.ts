import {
  type Camera,
  Color3,
  DirectionalLight,
  type Observer,
  type Scene,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { aabbToObb, type Bounds, fitBoxToView } from "./fit";
import { applyPose } from "./pose";
import { type CameraTrack, TurntableTrack } from "./track";

/** Key-light values mirrored from the main rig (`world.ts`) so export frames match the live view. */
const ANIM_LIGHT_INTENSITY = 0.48;
const ANIM_LIGHT_SPECULAR = new Color3(0.6, 0.6, 0.6);

/** Subset of `ViewportConfig` the animator needs to match the live camera's projection. */
export interface AnimatorViewport {
  fieldOfView: number;
  nearClipPlane: number;
  farClipPlane: number;
}

/** Dependencies injected by `World` (the owner). Keeps the animator free of an `app` import. */
export interface CameraAnimatorDeps {
  scene: Scene;
  /** The user's interactive camera, restored as active camera on stop. */
  mainCamera: Camera;
  viewport: AnimatorViewport;
  /** Draws one full frame (scene + axis + overlays) — injected as `world.renderOnce`. */
  renderOnce: () => void;
  /** Current scene bounds, used to frame the turntable orbit. */
  getBounds: () => Bounds | null;
  getAspectRatio: (camera: Camera) => number;
}

/** Shape of a turntable orbit, independent of how it is played back. */
export interface TurntableSpec {
  /** Total duration, in seconds. */
  duration: number;
  /** Whole turns over the duration. Default 1. */
  revolutions?: number;
  /** Polar angle from +Z, in radians. Default π/3. */
  polarAngle?: number;
}

/** Options for a deterministic turntable export. */
export interface TurntableOptions extends TurntableSpec {
  /** Frames per second (export only; preview is real-time). */
  fps: number;
}

/**
 * Drives a camera along a {@link CameraTrack} using a DEDICATED render camera,
 * so the user's interactive `ArcRotateCamera` is never mutated.
 *
 * Owned by `World`. Two drive modes share one `seek(t)`:
 * - {@link play} — real-time preview, advanced by `engine.getDeltaTime()`.
 * - {@link renderFrames} — deterministic, counter-driven export.
 *
 * The animator owns its own camera AND its own key light (the main `dirLight`
 * is parented to the main camera and would not follow `animCamera`). That
 * light is disabled while idle so it never contaminates the live view.
 */
export class CameraAnimator {
  readonly animCamera: UniversalCamera;

  private readonly scene: Scene;
  private readonly mainCamera: Camera;
  private readonly renderOnce: () => void;
  private readonly getBounds: () => Bounds | null;
  private readonly getAspectRatio: (camera: Camera) => number;
  private readonly light: DirectionalLight;

  private track: CameraTrack | null = null;
  private observer: Observer<Scene> | null = null;
  private elapsed = 0;
  /** Cancels stale render-loop callbacks across re-issued play() calls. */
  private epoch = 0;

  constructor(deps: CameraAnimatorDeps) {
    this.scene = deps.scene;
    this.mainCamera = deps.mainCamera;
    this.renderOnce = deps.renderOnce;
    this.getBounds = deps.getBounds;
    this.getAspectRatio = deps.getAspectRatio;

    const cam = new UniversalCamera(
      "animCamera",
      new Vector3(0, 0, 10),
      this.scene,
    );
    cam.upVector = new Vector3(0, 0, 1); // Z-up, matching the main camera.
    cam.fov = deps.viewport.fieldOfView;
    cam.minZ = deps.viewport.nearClipPlane;
    cam.maxZ = deps.viewport.farClipPlane;
    // Never attachControl — this camera is programmatic only.
    this.animCamera = cam;

    const light = new DirectionalLight(
      "animDirLight",
      new Vector3(0, 0, 1),
      this.scene,
    );
    light.parent = cam;
    light.intensity = ANIM_LIGHT_INTENSITY;
    light.specular = ANIM_LIGHT_SPECULAR.clone();
    light.setEnabled(false); // Only lit while the anim camera is active.
    this.light = light;
  }

  /** True while a real-time preview observer is registered. */
  get isPlaying(): boolean {
    return this.observer !== null;
  }

  /** Position the anim camera at normalized time `t`. Pure — touches no other camera. */
  seek(t: number): void {
    if (!this.track) return;
    applyPose(this.animCamera, this.track.sample(t));
  }

  /** Start a real-time preview of `track`. Idempotent: a second call replaces the track without double-registering. */
  play(track: CameraTrack): void {
    this.track = track;
    this.elapsed = 0;
    this.activate();
    this.seek(0);

    if (this.observer) return; // double-add guard

    const epoch = ++this.epoch;
    this.observer = this.scene.onBeforeRenderObservable.add(() => {
      if (epoch !== this.epoch || !this.track) return;
      this.elapsed += this.scene.getEngine().getDeltaTime() / 1000;
      const raw = this.elapsed / this.track.duration;
      const t = this.track.loop ? raw - Math.floor(raw) : Math.min(raw, 1);
      this.seek(t);
    });
  }

  /** Stop preview, unregister the observer, and restore the user's view. */
  stop(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    this.epoch += 1; // invalidate any in-flight callback
    this.deactivate();
  }

  /**
   * Render a deterministic turntable sequence. Frame-rate-independent: the
   * frame count is `round(duration * fps)` and time is driven by a counter,
   * not the wall clock. Restores the main camera on completion AND on error.
   *
   * @param capture Captures one frame to a data URL (injected as `app.screenshot`).
   * @returns PNG/data-URL strings, one per frame.
   */
  async renderFrames(
    opts: TurntableOptions,
    capture: () => Promise<string>,
  ): Promise<string[]> {
    const total = Math.max(1, Math.round(opts.duration * opts.fps));
    this.track = this.buildTurntable(opts);
    const frames: string[] = [];

    this.activate();
    try {
      for (let i = 0; i < total; i++) {
        this.seek(i / total);
        this.renderOnce();
        frames.push(await capture());
      }
    } finally {
      this.deactivate();
    }
    return frames;
  }

  /** Build a turntable track framing the current scene bounds. */
  buildTurntable(spec: TurntableSpec): TurntableTrack {
    const bounds = this.getBounds();
    const fit = bounds
      ? fitBoxToView(
          aabbToObb(bounds),
          this.animCamera.fov,
          this.getAspectRatio(this.animCamera),
        )
      : { center: Vector3.Zero(), radius: 10 };
    return new TurntableTrack({
      center: [fit.center.x, fit.center.y, fit.center.z],
      radius: fit.radius,
      duration: spec.duration,
      revolutions: spec.revolutions,
      polarAngle: spec.polarAngle,
      loop: true,
    });
  }

  /** Free the owned camera and light. */
  dispose(): void {
    this.stop();
    this.light.dispose();
    this.animCamera.dispose();
    this.track = null;
  }

  private activate(): void {
    this.scene.activeCamera = this.animCamera;
    this.light.setEnabled(true);
  }

  private deactivate(): void {
    this.scene.activeCamera = this.mainCamera;
    this.light.setEnabled(false);
  }
}
