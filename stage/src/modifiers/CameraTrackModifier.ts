/**
 * Pipeline modifier that drives the live camera along a keyframe path.
 *
 * Side-effect only (returns the input frame). Playback runs on the Babylon
 * render loop so Python/RPC never blocks. Removing the modifier (or
 * disabling it) stops motion immediately — that is the product contract for
 * ``stage.camera.track``.
 */

import type { Observer, Scene, TargetCamera } from "@babylonjs/core";
import type { Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import { applyPose, type CameraPose, type Vec3 } from "../camera/pose";
import { KeyframeTrack } from "../camera/track";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";

export type CameraTrackKey = {
  position: Vec3;
  target: Vec3;
  up?: Vec3;
};

export type CameraTrackSpec = {
  /** At least two poses along the path. */
  keys: readonly CameraTrackKey[];
  /**
   * Content seconds for one lap (or one-shot path). Independent of display
   * refresh and of {@link rate}.
   */
  duration: number;
  /** Wrap forever when true. */
  loop: boolean;
  /**
   * Pure speed multiplier — **not** a frame rate.
   * Wall-clock lap = content {@link duration} / rate.
   * `1` = real-time, `2` = twice as fast, `0.5` = half speed.
   */
  rate: number;
};

export class CameraTrackModifier extends BaseModifier {
  static readonly NAME = "Camera track";

  private _keys: CameraTrackKey[] = [];
  private _duration = 12;
  private _loop = true;
  private _rate = 1;
  private _track: KeyframeTrack | null = null;
  private _observer: Observer<Scene> | null = null;
  private _scene: Scene | null = null;
  private _camera: TargetCamera | null = null;
  private _elapsed = 0;
  private _playing = false;

  constructor(id = "camera-track") {
    super(
      id,
      CameraTrackModifier.NAME,
      // Draws: side-effect visual; applyVisibility is invoked on enable/remove.
      new Set([ModifierCapability.Draws]),
    );
  }

  get keys(): readonly CameraTrackKey[] {
    return this._keys;
  }
  get duration(): number {
    return this._duration;
  }
  get loop(): boolean {
    return this._loop;
  }
  get rate(): number {
    return this._rate;
  }
  get isPlaying(): boolean {
    return this._playing;
  }

  /** Replace the path / timing and rebuild the internal track. */
  setSpec(spec: CameraTrackSpec): void {
    if (spec.keys.length < 2) {
      throw new Error("Camera track needs at least two key poses");
    }
    if (!(spec.duration > 0) || !Number.isFinite(spec.duration)) {
      throw new Error("Camera track duration must be a finite number > 0");
    }
    if (!(spec.rate > 0) || !Number.isFinite(spec.rate)) {
      throw new Error("Camera track rate must be a finite number > 0");
    }
    this._keys = spec.keys.map((k) => ({
      position: [k.position[0], k.position[1], k.position[2]] as Vec3,
      target: [k.target[0], k.target[1], k.target[2]] as Vec3,
      up: k.up ? ([k.up[0], k.up[1], k.up[2]] as Vec3) : ([0, 0, 1] as Vec3),
    }));
    this._duration = spec.duration;
    this._loop = Boolean(spec.loop);
    this._rate = spec.rate;
    this._track = this.buildTrack();
    this._elapsed = 0;
  }

  setDuration(v: number): void {
    if (!(v > 0) || !Number.isFinite(v)) return;
    this._duration = v;
    this._track = this.buildTrack();
    this._elapsed = 0;
  }

  setLoop(v: boolean): void {
    this._loop = v;
    this._track = this.buildTrack();
  }

  setRate(v: number): void {
    if (!(v > 0) || !Number.isFinite(v)) return;
    this._rate = v;
    this._track = this.buildTrack();
    this._elapsed = 0;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:d=${this._duration}:l=${this._loop}:r=${this._rate}:k=${this._keys.length}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    if (this.enabled && this._keys.length >= 2) {
      this.start(context.app);
    } else {
      this.stop();
    }
    return input;
  }

  applyVisibility(app: MolvisApp, visible: boolean): void {
    if (visible && this.enabled && this._keys.length >= 2) {
      this.start(app);
    } else {
      this.stop();
    }
  }

  /** Pipeline remove hook — stop the render-loop driver. */
  onRemoved(): void {
    this.stop();
  }

  start(app: MolvisApp): void {
    if (this._keys.length < 2) return;

    const scene = app.world.scene;
    const camera = app.world.camera as TargetCamera;
    // Already bound to this scene/camera with an observer — keep going.
    if (
      this._playing &&
      this._scene === scene &&
      this._camera === camera &&
      this._track
    ) {
      return;
    }

    // Tear down any prior observer only — do NOT null _track (stop() used to
    // clear it, then the line below crashed: _track.sample on null).
    this.stopPlaybackKeepPose();
    const track = this._track ?? this.buildTrack();
    this._track = track;
    this._scene = scene;
    this._camera = camera;
    this._elapsed = 0;
    this._playing = true;

    // Sample first pose immediately so the first frame is not a blank tick.
    applyPose(camera, track.sample(0));

    this._observer = scene.onBeforeRenderObservable.add(() => {
      const active = this._track;
      const cam = this._camera;
      if (!this._playing || !active || !cam) return;
      // Real wall dt from the engine — independent of any fps knob.
      // rate only scales content time so wall_lap = duration / rate.
      const wallDt = scene.getEngine().getDeltaTime() / 1000;
      this._elapsed += wallDt * this._rate;
      const raw = this._elapsed / this._duration;
      const t = this._loop ? raw - Math.floor(raw) : Math.min(raw, 1);
      applyPose(cam, active.sample(t));
      if (!this._loop && t >= 1) {
        // One-shot finished: stay at end pose, drop the observer.
        this.stopPlaybackKeepPose();
      }
    });
  }

  /**
   * Stop the render-loop driver. Keeps the path spec (`_keys` / `_track`) so
   * re-enable / re-start after disable does not need another setSpec.
   */
  stop(): void {
    this.stopPlaybackKeepPose();
    this._scene = null;
    this._camera = null;
  }

  private stopPlaybackKeepPose(): void {
    if (this._observer && this._scene) {
      this._scene.onBeforeRenderObservable.remove(this._observer);
    }
    this._observer = null;
    this._playing = false;
  }

  private buildTrack(): KeyframeTrack {
    const n = this._keys.length;
    const keyframes = this._keys.map((k, i) => {
      const pose: CameraPose = {
        position: k.position,
        target: k.target,
        up: k.up,
      };
      return {
        t: n <= 1 ? 0 : i / (n - 1),
        pose,
      };
    });
    return new KeyframeTrack({
      keyframes,
      duration: this._duration,
      loop: this._loop,
    });
  }
}
