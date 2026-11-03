import {
  type Camera,
  Engine,
  type EngineView,
  type Observer,
  type PointerInfo,
} from "@babylonjs/core";
import type { Molvis } from "@molcrafts/molvis-stage";

interface SharedView {
  readonly app: Molvis;
  readonly view: EngineView;
  readonly onViewChange: Observer<Camera> | null;
  readonly onPointer: Observer<PointerInfo> | null;
  readonly onFocus: () => void;
  visible: boolean;
  /** Frames still to draw; a view with none left keeps its last image. */
  pending: number;
}

/**
 * Frames to draw after a change. Babylon's view step resizes the shared
 * drawing buffer to the view before it draws, so a second frame settles any
 * first-frame size change.
 */
const SETTLE_FRAMES = 2;

/**
 * One BabylonJS engine behind every `<molvis-viewer engine="shared">` on a
 * page.
 *
 * Each viewer keeps its own scene and camera and draws through an engine view
 * onto its own 2D canvas; one hidden WebGL canvas owns the only context. A
 * view is drawn only while it is on screen and something changed (load,
 * resize, pointer input, camera motion), so idle viewers cost nothing per
 * frame. A camera turns only when its scene renders, so pointer input wakes
 * the view and camera motion (inertia included) keeps it drawing. Pointer
 * input follows the viewer under the pointer: only that scene and camera
 * listen, so dragging one structure never turns another.
 */
export class SharedViewerEngine {
  private static current: SharedViewerEngine | null = null;

  /** The page's shared engine, created on first use. */
  static acquire(): SharedViewerEngine {
    SharedViewerEngine.current ??= new SharedViewerEngine();
    return SharedViewerEngine.current;
  }

  readonly engine: Engine;
  private readonly masterCanvas: HTMLCanvasElement;
  private readonly views = new Map<HTMLCanvasElement, SharedView>();
  private focused: HTMLCanvasElement | null = null;

  private readonly render = (): void => {
    const target = this.engine.activeView?.target;
    if (!target) return;
    const entry = this.views.get(target);
    if (!entry) return;
    entry.app.world.renderOnce();
    entry.pending = Math.max(0, entry.pending - 1);
    if (entry.pending === 0) entry.view.enabled = false;
  };

  private constructor() {
    this.masterCanvas = document.createElement("canvas");
    this.masterCanvas.dataset.molvisSharedEngineCanvas = "";
    this.masterCanvas.width = 1;
    this.masterCanvas.height = 1;
    this.masterCanvas.setAttribute("aria-hidden", "true");
    this.masterCanvas.style.cssText =
      "position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(this.masterCanvas);
    this.engine = new Engine(
      this.masterCanvas,
      true,
      { alpha: false, preserveDrawingBuffer: false, stencil: true },
      true,
    );
    this.engine.runRenderLoop(this.render);
  }

  /** Draw `app` onto `canvas` through this engine. */
  add(canvas: HTMLCanvasElement, app: Molvis): void {
    if (this.views.has(canvas)) {
      throw new Error("This canvas already has a shared-engine view.");
    }
    const view = this.engine.registerView(canvas, app.world.camera, true);
    const onFocus = () => this.focus(canvas);
    canvas.addEventListener("pointerenter", onFocus);
    canvas.addEventListener("pointerdown", onFocus);
    const entry: SharedView = {
      app,
      view,
      onViewChange: app.world.camera.onViewMatrixChangedObservable.add(() =>
        this.invalidate(canvas),
      ),
      onPointer: app.world.scene.onPointerObservable.add(() =>
        this.invalidate(canvas),
      ),
      onFocus,
      visible: false,
      pending: SETTLE_FRAMES,
    };
    view.enabled = false;
    this.views.set(canvas, entry);
    // Only the viewer under the pointer listens; the rest wait for focus.
    app.world.camera.detachControl();
    app.world.scene.detachControl();
  }

  /** Draw the view again on the next frames, if it is on screen. */
  invalidate(canvas: HTMLCanvasElement): void {
    const entry = this.views.get(canvas);
    if (!entry) return;
    entry.pending = SETTLE_FRAMES;
    entry.view.enabled = entry.visible;
  }

  /** Mark the view on or off screen; an off-screen view is never drawn. */
  setVisible(canvas: HTMLCanvasElement, visible: boolean): void {
    const entry = this.views.get(canvas);
    if (!entry) return;
    entry.visible = visible;
    entry.view.enabled = visible && entry.pending > 0;
  }

  /** Stop drawing `canvas`; the engine goes once its last view does. */
  remove(canvas: HTMLCanvasElement): void {
    const entry = this.views.get(canvas);
    if (!entry) return;
    canvas.removeEventListener("pointerenter", entry.onFocus);
    canvas.removeEventListener("pointerdown", entry.onFocus);
    entry.onViewChange?.remove();
    entry.onPointer?.remove();
    this.engine.unRegisterView(canvas);
    this.views.delete(canvas);
    if (this.focused === canvas) {
      this.focused = null;
      this.engine.inputElement = null;
    }
    if (this.views.size === 0) this.dispose();
  }

  private focus(canvas: HTMLCanvasElement): void {
    if (this.focused === canvas) return;
    const previous = this.focused ? this.views.get(this.focused) : undefined;
    previous?.app.world.camera.detachControl();
    previous?.app.world.scene.detachControl();
    const entry = this.views.get(canvas);
    if (!entry) return;
    this.focused = canvas;
    this.engine.inputElement = canvas;
    entry.app.world.scene.attachControl();
    entry.app.world.camera.attachControl(true);
  }

  private dispose(): void {
    this.engine.stopRenderLoop(this.render);
    this.engine.dispose();
    this.masterCanvas.remove();
    if (SharedViewerEngine.current === this) SharedViewerEngine.current = null;
  }
}
