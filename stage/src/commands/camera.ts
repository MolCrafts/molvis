import type { MolvisApp } from "../app";
import { Command, command } from "./base";

/** Arguments for {@link CameraAnimateCommand}. */
export interface CameraAnimateArgs {
  /** Total duration of one playback cycle, in seconds. Default 8. */
  duration?: number;
  /** Whole turns over the duration. Default 1. */
  revolutions?: number;
  /** Polar angle from +Z, in radians. Default π/3. */
  polarAngle?: number;
}

const DEFAULT_DURATION = 8;

/**
 * Start a real-time turntable preview, orbiting the current scene through the
 * dedicated animation camera.
 *
 * Transient by design: like {@link TakeSnapshotCommand}, `undo()` returns
 * `this` and the command never enters the undo history. Stopping the preview
 * is a separate view action, not an undo.
 */
@command("animate_camera")
export class CameraAnimateCommand extends Command<void> {
  private readonly args: CameraAnimateArgs;

  constructor(app: MolvisApp, args: CameraAnimateArgs) {
    super(app);
    this.args = args ?? {};
  }

  do(): void {
    const animator = this.app.world.cameraAnimator;
    const track = animator.buildTurntable({
      duration: this.args.duration ?? DEFAULT_DURATION,
      revolutions: this.args.revolutions,
      polarAngle: this.args.polarAngle,
    });
    animator.play(track);
  }

  undo(): Command {
    return this;
  }
}
