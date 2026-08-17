import type { Engine } from "@babylonjs/core";
import { Frame } from "@molcrafts/molvis-core/molrs";
import { MolvisApp } from "./app";
import type { RepresentationId } from "./artist/representation";
import type { Theme } from "./artist/theme";
import type { MolvisConfig } from "./config";
import type { MolvisSetting } from "./settings";
import { Trajectory } from "./system/trajectory";

/** A loadable structure: a single frame, a list of frames, or a trajectory. */
export type RenderInput = Frame | Frame[] | Trajectory;

/** Options accepted by {@link MolvisRenderer.snapshot} (mirrors `MolvisApp.screenshot`). */
export type SnapshotOptions = Parameters<MolvisApp["screenshot"]>[0];

/** Options accepted by {@link MolvisRenderer.renderAnimation} (mirrors `MolvisApp.exportTurntable`). */
export type AnimationOptions = Parameters<MolvisApp["exportTurntable"]>[0];

/** Construction options for {@link MolvisRenderer}. */
export interface MolvisRendererOptions {
  /**
   * Inject a pre-built BabylonJS engine (e.g. `NullEngine` in tests, or a
   * `WebGPUEngine`). When omitted, a WebGL `Engine` is created on the canvas.
   */
  engine?: Engine;
  /**
   * Extra app config. `gui` and `engine` are managed by the facade and cannot
   * be set here — the renderer is always GUI-less.
   */
  config?: Omit<MolvisConfig, "gui" | "engine">;
  /** Initial viewport / interaction settings forwarded to the underlying app. */
  setting?: Partial<MolvisSetting>;
}

/**
 * Semi-headless rendering facade over {@link MolvisApp}.
 *
 * Lets another frontend (e.g. the molexp molvis plugin) drive molvis-core
 * programmatically inside a browser host — load a structure, set its
 * representation/background, frame the camera, and produce a single snapshot or
 * a turntable animation — **without** mounting the three-panel GUI, sidebar, or
 * interaction modes.
 *
 * It is a thin composition, not a reimplementation: it owns a `gui: false`
 * `MolvisApp` and delegates every operation to the app's existing imperative
 * API. Data always enters through the modifier pipeline's single ingress
 * ({@link MolvisApp.setTrajectory}); snapshots render on demand via
 * `World.renderOnce` and never start the interactive render loop.
 *
 * @example
 * ```ts
 * const renderer = new MolvisRenderer(hiddenCanvas);
 * await renderer.load(trajectory);
 * renderer.fit();
 * const png = await renderer.snapshot({ width: 1920, height: 1080 });
 * ```
 */
export class MolvisRenderer {
  private readonly _app: MolvisApp;

  /**
   * @param canvas A render surface (typically hidden or offscreen). It may
   *   already be attached to the DOM or fully detached.
   * @param options Engine injection, extra config, and initial settings.
   */
  constructor(canvas: HTMLCanvasElement, options: MolvisRendererOptions = {}) {
    this._app = new MolvisApp(
      canvas,
      { ...options.config, gui: false, engine: options.engine },
      options.setting,
    );
  }

  /** Escape hatch: the underlying GUI-less {@link MolvisApp} for advanced use. */
  get app(): MolvisApp {
    return this._app;
  }

  /**
   * Load a structure through the pipeline's single ingress and draw it once.
   *
   * Replaces the primary data source with the given input, then runs the
   * modifier pipeline so the scene has content to capture. Does not start the
   * interactive render loop.
   */
  async load(input: RenderInput): Promise<void> {
    // setTrajectory → replaceScene installs the primary DS and auto-attaches
    // default Draws (Particles / Bonds / …). applyAutoAttach is idempotent.
    await this._app.setTrajectory(toTrajectory(input));
    await this._app.applyPipeline({ changeKind: "full" });
  }

  /** Set the atom/bond representation (e.g. `"ball-and-stick"`). */
  setRepresentation(id: RepresentationId): Promise<void> {
    return this._app.setRepresentation(id);
  }

  /** Toggle the optional heavy outline on 2-D representations. */
  setRepresentationOutline(enabled: boolean): Promise<void> {
    return this._app.setRepresentationOutline(enabled);
  }

  /** Set the scene background color from a `#rrggbb` / `#rrggbbaa` string. */
  setBackgroundColor(color: string): void {
    this._app.setBackgroundColor(color);
  }

  /** Apply a color/material theme and re-render the current frame. */
  setTheme(theme: Theme): void {
    this._app.setTheme(theme);
  }

  /** Frame the whole scene in view (empty → home pose). */
  fit(): void {
    this._app.world.fit();
  }

  /** Park the camera at the empty-scene home pose. */
  reset(): void {
    this._app.world.reset();
  }

  /** Set the display size, in CSS pixels. */
  setSize(width: number, height: number): void {
    this._app.setSize(width, height);
  }

  /** Set the render-target resolution, in device pixels. */
  setResolution(width: number, height: number): void {
    this._app.setRenderResolution(width, height);
  }

  /**
   * Render the current scene once and capture it as an image data URL.
   *
   * Uses render-to-texture, so it does not depend on an on-screen canvas and
   * never starts the render loop.
   */
  async snapshot(options?: SnapshotOptions): Promise<string> {
    this._app.world.renderOnce();
    return this._app.screenshot(options);
  }

  /**
   * Render a deterministic turntable animation, returning one image data URL
   * per frame (`round(duration * fps)` frames). Encoding to GIF/MP4 is the
   * caller's responsibility.
   */
  async renderAnimation(options: AnimationOptions): Promise<string[]> {
    return this._app.exportTurntable(options);
  }

  /** Tear down the underlying app, engine, and scene. */
  dispose(): void {
    this._app.destroy();
  }
}

/** Normalize any {@link RenderInput} into a {@link Trajectory}. */
function toTrajectory(input: RenderInput): Trajectory {
  if (input instanceof Trajectory) return input;
  if (input instanceof Frame) return new Trajectory([input]);
  return new Trajectory(input);
}
