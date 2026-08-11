import { Color4, Engine, Tools } from "@babylonjs/core";
import type { App } from "@molcrafts/molvis-core/app";
import {
  cropToContent,
  reencodeImage,
} from "@molcrafts/molvis-core/image-crop";
import type { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { frameHasStructure } from "./analysis/requirements";
import { Artist } from "./artist";
import {
  findRepresentation,
  type RepresentationId,
} from "./artist/representation";
import { StyleManager } from "./artist/style_manager";
import type { Theme } from "./artist/theme";
import {
  type CommandRegistry,
  commands,
  registerDefaultCommands,
} from "./commands";
import { CommandManager } from "./commands/manager";
import { SetRepresentationCommand } from "./commands/representation";
import { defaultMolvisConfig, type MolvisConfig } from "./config";
import type { CoordinatePolicy } from "./coords";
import { createMolvisDOM, registerWebComponents } from "./dom_helpers";
import { EventEmitter, type MolvisEventMap } from "./events";
import { exportFrameToGLB, type GltfExportOptions } from "./export/gltf";
import { FrameRenderScheduler } from "./frame_render_scheduler";
import { disposeLoadedFile } from "./io";
import { ModeManager, ModeType } from "./mode";
import { SelectMode } from "./mode/select";
import type { MenuItem, SceneHit } from "./mode/types";
import { OverlayManager } from "./overlays/overlay_manager";
import type { AtomAnchored, Overlay } from "./overlays/types";
import { ModifierPipeline, PipelineEvents } from "./pipeline";
import { applyAutoAttach } from "./pipeline/auto_attach";
import {
  DataSource,
  type DataSourceOptions,
  MemoryDataSource,
} from "./pipeline/data_source";
import { primaryDataSource } from "./pipeline/empty_scene";
import type { PipelineEntry } from "./pipeline/entry";
import { type Modifier, ModifierCapability } from "./pipeline/modifier";
import { registerDefaultModifiers } from "./pipeline/modifier_registry";
import type {
  FrameChangeKind,
  PipelineContext,
  SelectionMask,
} from "./pipeline/types";
import { defaultSaveFile } from "./save_file";
import { SceneSession } from "./scene_session";
import { materializeFrameFromScene } from "./scene_sync";
import {
  captureStructuralSelectionSnapshot,
  reconcileSelectionAfterStructuralUpdate,
} from "./selection_reconciler";
import { type MolvisSetting, Settings } from "./settings";
import { System } from "./system";
import {
  classifyFrameTransition,
  type FrameTransitionDecision,
  type FrameUpdateKind,
} from "./system/frame_diff";
import type { Trajectory } from "./system/trajectory";
import { GUIManager } from "./ui/manager";
import { logger } from "./utils/logger";
import { createRafCoalesce } from "./utils/raf_coalesce";
import { MOLVIS_VERSION } from "./version";
import { World } from "./world";

function asAtomAnchored(overlay: Overlay): AtomAnchored | null {
  const a = overlay as Partial<AtomAnchored>;
  return typeof a.getAnchorAtomId === "function" &&
    typeof a.syncToAtomPosition === "function"
    ? (a as AtomAnchored)
    : null;
}

export class MolvisApp implements App {
  // DOM elements
  private _container: HTMLElement;
  private _root: HTMLElement;
  private _canvas: HTMLCanvasElement;
  private _uiOverlay: HTMLElement;

  // Core components
  private _config: MolvisConfig;
  private _engine: Engine;
  private readonly _ownsEngine: boolean;
  private _world: World;
  private _system: System;
  // Optional: absent on the GUI-less ("semi-headless") construction path.
  private _modeManager?: ModeManager;
  private _guiManager?: GUIManager;
  private _isRunning = false;
  private _rendererReady = true;
  /** Keeps the drawing buffer in sync when the host container is resized. */
  private _resizeObserver: ResizeObserver | null = null;
  /** Coalesces ResizeObserver → resize during continuous layout (splitter drag). */
  private _resizeCoalesce: import("./utils/raf_coalesce").RafCoalesce | null =
    null;

  // Pipelines
  private _modifierPipeline: ModifierPipeline;
  private _currentFrame = 0;
  private _lastRenderedFrame: Frame | null = null;
  private _lastSelectionSet: Map<string, SelectionMask> = new Map();
  private readonly _frameScheduler: FrameRenderScheduler;
  /** Scene / data-source orchestration (extracted from this façade). */
  private _sceneSession!: SceneSession;

  // Style System
  private _styleManager: StyleManager;

  // Command registry (Registry/RPC)
  readonly commands: CommandRegistry;

  // Command Manager (History/Undo/Redo)
  public readonly commandManager: CommandManager;

  // Artist (high-level drawing API)
  public readonly artist: Artist;

  // Events
  public readonly events = new EventEmitter<MolvisEventMap>();

  // Overlay system
  public readonly overlayManager: OverlayManager;

  // User settings (public API)
  public readonly settings: Settings;

  /**
   * Pluggable file-save handler. Override to integrate with host environment
   * (e.g. VSCode webview → postMessage → extension host → showSaveDialog).
   * Default: uses the File System Access API (showSaveFilePicker).
   */
  public saveFile: (blob: Blob, suggestedName: string) => Promise<void> =
    defaultSaveFile;

  constructor(
    container: HTMLElement | HTMLCanvasElement,
    config: MolvisConfig = {},
    setting?: Partial<MolvisSetting>,
  ) {
    this._config = defaultMolvisConfig(config);
    logger.info(`Molvis initializing (v${MOLVIS_VERSION})`);

    // Status bar ↔ log: same text (incl. progress %). Logger → native console.
    this.events.on("status-message", ({ text, type, progress }) => {
      const line =
        progress !== undefined && Number.isFinite(progress)
          ? `${text.trim()} ${Math.round(Math.max(0, Math.min(100, progress)))}%`
          : text.trim();
      if (!line) return;
      if (type === "error") {
        logger.error(line);
      } else if (type === "warning") {
        logger.warn(line);
      } else {
        logger.info(line);
      }
    });

    // Ensure default command/modifier registries are populated. Both are
    // idempotent; subsequent calls are no-ops.
    registerDefaultCommands();
    registerDefaultModifiers();

    const headless = this._config.gui === false;
    if (headless) {
      // Semi-headless: no DOM chrome, no web components, no sidebar GUI. The
      // caller provides the render surface (a possibly hidden/offscreen canvas)
      // either as the `container` arg or builds one for us. A detached root and
      // hidden overlay stand in so DOM-touching getters/methods stay total.
      this._canvas =
        container instanceof HTMLCanvasElement
          ? container
          : document.createElement("canvas");
      const root = document.createElement("div");
      if (!(container instanceof HTMLCanvasElement)) {
        root.appendChild(this._canvas);
      }
      this._root = root;
      this._container =
        container instanceof HTMLCanvasElement ? root : container;
      this._uiOverlay = document.createElement("div");
      this._uiOverlay.style.display = "none";
    } else {
      // Register Web Components & create DOM
      this._container = container;
      registerWebComponents();
      const dom = createMolvisDOM(this._container, this._config);
      this._root = dom.root;
      this._canvas = dom.canvas;
      this._uiOverlay = dom.uiOverlay;
    }

    // Core owns resize: observe the mount container so every host
    // (demo, page, vsc-ext, <molvis-viewer>) gets a correct drawing buffer
    // without wiring ResizeObserver themselves.
    if (typeof ResizeObserver !== "undefined") {
      this._resizeCoalesce = createRafCoalesce(() => {
        this.resize();
      });
      this._resizeObserver = new ResizeObserver(() => {
        // One engine.resize per frame while the host splitters drag.
        this._resizeCoalesce?.schedule();
      });
      this._resizeObserver.observe(this._container);
    }

    // Initialize Babylon engine — reuse an injected engine when provided
    // (headless/testing, e.g. NullEngine), else create a WebGL engine.
    this._engine =
      this._config.engine ??
      new Engine(
        this._canvas,
        this._config.canvas?.antialias ?? true,
        {
          preserveDrawingBuffer:
            this._config.canvas?.preserveDrawingBuffer ?? true,
          stencil: this._config.canvas?.stencil ?? true,
          alpha: this._config.canvas?.alpha ?? false,
        },
        true,
      );
    this._ownsEngine =
      this._config.engine === undefined ||
      this._config.engineOwnership !== "external";

    // Initialize World
    this._world = new World(this._canvas, this._engine, this);

    // Initialize Style Manager (before ModeManager)
    this._styleManager = new StyleManager(this._world.scene);

    // Initialize Overlay Manager
    this.overlayManager = new OverlayManager(this._world.scene);

    // Initialize settings
    this.settings = new Settings(this, setting);

    // Initialize System
    this._system = new System(this.events);

    // Initialize GUI + interaction modes — skipped entirely when headless.
    // The render core above (engine, world, scene, pipeline, artist) is all a
    // semi-headless consumer needs for snapshots/animations.
    if (!headless) {
      // Initialize GUI
      this._guiManager = new GUIManager(this._container, this, this._config);
      this._guiManager.mount();

      // Initialize default mode (View mode)
      this._modeManager = new ModeManager(this);
      this._modeManager.switch_mode(ModeType.View);
      this._world.setMode(this._modeManager);
    }

    // Initialize modifier pipeline
    this._modifierPipeline = new ModifierPipeline();

    // Initialize Artist (Drawing Logic)
    this.artist = new Artist({ app: this });

    // Initialize command registry (use shared singleton)
    this.commands = commands;

    // Initialize Command Manager
    this.commandManager = new CommandManager(this);

    // Coalescing scheduler for trajectory-frame renders (latest-wins).
    this._frameScheduler = new FrameRenderScheduler(
      (forceFull) => this.renderActiveTrajectoryFrame(forceFull),
      (error) => logger.error("Failed to render trajectory frame", error),
    );

    this._sceneSession = new SceneSession({
      artist: this.artist,
      commandManager: this.commandManager,
      pipeline: this._modifierPipeline,
      system: this._system,
      isRunning: () => this._isRunning,
      setFrameIndex: (index) => {
        this._currentFrame = index;
      },
      clearLastRenderedFrame: () => {
        this._lastRenderedFrame = null;
      },
      renderActiveTrajectoryFrame: (forceFull) =>
        this.renderActiveTrajectoryFrame(forceFull),
      applyPipeline: (opts) => this.applyPipeline(opts),
    });

    // Boot: empty pipeline + length-1 system trajectory. User adds a Source
    // via Open / Stream; composition with zero sources yields an empty Frame.
    this._sceneSession.bootstrapEmptyPrimary();
    this._currentFrame = this._system.trajectory.currentIndex;

    // Wire scene-level dirty tracking to event bus
    this._world.sceneIndex.onDirtyChange = (isDirty: boolean) => {
      this.events.emit("dirty-change", isDirty);
    };

    // Named pipeline selections (modifier producers) for analysis tools.
    // Live canvas SelectionManager is independent — see WYSIWYG invariant.
    this._modifierPipeline.on(PipelineEvents.COMPUTED, ({ context }) => {
      this._lastSelectionSet = new Map(context.selectionSet);
    });

    // Sync atom-anchored overlays from SceneIndex (canvas positions), not HEAD.
    this.events.on("frame-rendered", () => {
      this._syncAnchoredOverlays();
    });
  }

  // Getters
  get canvas(): HTMLCanvasElement {
    return this._canvas;
  }

  get world(): World {
    return this._world;
  }

  get scene() {
    return this._world.scene;
  }

  get mode() {
    return this._world.mode;
  }

  get modifierPipeline(): ModifierPipeline {
    return this._modifierPipeline;
  }

  /** Post-compose coordinate policy (as-deposited | wrap-* | unwrap-trajectory). */
  get coordinatePolicy(): CoordinatePolicy {
    return this._modifierPipeline.coordinatePolicy;
  }

  setCoordinatePolicy(policy: CoordinatePolicy): void {
    this._modifierPipeline.setCoordinatePolicy(policy);
  }

  /** Named selections from the last pipeline run. */
  get selectionSet(): ReadonlyMap<string, SelectionMask> {
    return this._lastSelectionSet;
  }

  get styleManager(): StyleManager {
    return this._styleManager;
  }

  get gui(): GUIManager {
    if (!this._guiManager) {
      throw new Error("GUI is not available on a headless (gui:false) app");
    }
    return this._guiManager;
  }

  get rootContainer(): HTMLElement {
    return this._root;
  }

  get uiContainer(): HTMLElement {
    return this._uiOverlay;
  }

  get mountPoint(): HTMLElement {
    return this._container;
  }

  get config(): MolvisConfig {
    return this._config;
  }

  get displaySize(): { width: number; height: number } {
    const rect = this._root.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  get renderResolution(): { width: number; height: number } {
    return { width: this._canvas.width, height: this._canvas.height };
  }

  get pixelRatio(): number {
    const size = this.displaySize;
    if (size.width === 0) return 1;
    return this._canvas.width / size.width;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get rendererReady(): boolean {
    return this._rendererReady;
  }

  get currentFrame(): number {
    return this._currentFrame;
  }

  set currentFrame(value: number) {
    this._currentFrame = value;
  }

  get frame(): Frame | null {
    return this._system.frame;
  }

  get system(): System {
    return this._system;
  }

  // Public methods
  /**
   * Execute a command by name.
   * @param name Command name
   * @param args Command arguments
   * @returns Promise if command is async, void otherwise
   */
  public execute<A, R = unknown>(name: string, args: A): R | Promise<R> {
    return this.commands.execute(name, this, args);
  }

  public async pickAtPointer(
    pointerX: number,
    pointerY: number,
  ): Promise<SceneHit> {
    return this._world.picker.pick(pointerX, pointerY);
  }

  public resolveContextMenuItems(context: {
    menuId: string;
    hit: SceneHit | null;
    items: readonly MenuItem[];
  }): MenuItem[] {
    const builder = this._config.ui?.contextMenu?.buildItems;
    if (!builder) {
      return [...context.items];
    }

    try {
      return builder({
        app: this,
        menuId: context.menuId,
        hit: context.hit,
        items: [...context.items],
      });
    } catch (error) {
      logger.error("Failed to customize context menu", error);
      return [...context.items];
    }
  }

  public async start(): Promise<void> {
    if (this._isRunning) return;

    this._isRunning = true;
    this._world.start();

    // Render the initial frame so mesh layers are registered and
    // edit-mode can draw into an empty scene.
    await this.renderActiveTrajectoryFrame(true);

    logger.info("Molvis started successfully");
  }

  public stop(): void {
    if (!this._isRunning) return;
    this._isRunning = false;
    this._world.stop();
    logger.info("Molvis stopped successfully");
  }

  public resize = (): void => {
    // Let Babylon's engine.resize() read the canvas CSS size and update the
    // drawing-buffer dimensions internally.  Manually setting canvas.width /
    // canvas.height *before* the engine does it clears the bitmap and causes a
    // visible flash during continuous resize (e.g. dragging a splitter).
    this._world.resize();
  };

  public setSize(displayWidth: number, displayHeight: number): void {
    this._root.style.width = `${displayWidth}px`;
    this._root.style.height = `${displayHeight}px`;
    this.resize();
  }

  public setRenderResolution(renderWidth: number, renderHeight: number): void {
    this._canvas.width = renderWidth;
    this._canvas.height = renderHeight;
    this._world.resize();
  }

  public enableFitContainer(enabled: boolean): void {
    if (enabled) {
      this._root.style.width = "100%";
      this._root.style.height = "100%";
    }
    this.resize();
  }

  /**
   * Commit the working tree (SceneIndex edit pool) into molrs HEAD
   * ({@link System.frame} + pipeline primary DataSource). Like `git commit`.
   *
   * Writes the built frame into System HEAD + the pipeline primary DataSource
   * (creates a memory primary when the pipeline is still empty), rebinds meta
   * so hover / pick keep resolving atom info, auto-attaches Draw modifiers
   * when structure appears for the first time, and rebuilds the GPU scene.
   */
  public async commitScene(): Promise<void> {
    const sourceFrame = this._system.frame;
    if (!sourceFrame) return;
    const built = materializeFrameFromScene(this._world.sceneIndex, {
      sourceFrame,
    });
    const saved = built.frame;

    // Remap live canvas selection through dense re-index before dropping
    // the edit pool — sparse edit ids become 0..N-1 rows.
    const sm = this._world.selectionManager;
    const prevAtoms = [...sm.getSelectedAtomIds()];
    const prevBonds = [...sm.getSelectedBondIds()];
    if (prevAtoms.length > 0 || prevBonds.length > 0) {
      const nextAtoms = prevAtoms
        .map((id) => built.atomIdToFrameIndex.get(id))
        .filter((row): row is number => row !== undefined);
      const nextBonds = prevBonds
        .map((id) => built.bondIdToFrameIndex.get(id))
        .filter((row): row is number => row !== undefined);
      sm.apply({ type: "replace", atoms: nextAtoms, bonds: nextBonds });
    }

    this._system.updateCurrentFrame(saved);

    let primary = primaryDataSource(this._modifierPipeline);
    // Sketch/edit on an empty pipeline: install a memory primary so commit
    // has a composition head (user-facing name stays "Memory Source").
    if (!primary) {
      const atomCount = saved.getBlock("atoms")?.nrows() ?? 0;
      if (atomCount > 0) {
        const ds = new MemoryDataSource(saved, {
          sourceType: "backend",
          filename: "Scene",
        });
        this._modifierPipeline.addSource(ds);
        this._system.trajectory = ds.trajectory;
        primary = ds;
      }
    }
    // When System already shares the primary DS trajectory,
    // updateCurrentFrame already mutated that trajectory.
    // Only rewrite a *separate* memory primary (e.g. after load swap).
    if (
      primary &&
      primary.trajectory !== this._system.trajectory &&
      primary.kind === "memory" &&
      primary.frameCount === 1
    ) {
      primary.trajectory.replaceFrame(0, saved);
    }

    // Point meta at the committed frame and drop the edit overlay so
    // hover/pick resolve through the dense HEAD layout (0..N-1). Without
    // this, edit-pool IDs and GPU thin-instance indices can drift after
    // the next pipeline rebuild and atom info goes blank.
    this._world.sceneIndex.metaRegistry.atoms.setFrame(saved);
    this._world.sceneIndex.metaRegistry.atoms.edits.clear();
    this._world.sceneIndex.metaRegistry.bonds.setFrame(saved);
    this._world.sceneIndex.metaRegistry.bonds.edits.clear();

    const atomCount = saved.getBlock("atoms")?.nrows() ?? 0;
    if (atomCount > 0 && primary) {
      const hadDraw = this._modifierPipeline
        .modifiers()
        .some((m) => m.capabilities.has(ModifierCapability.Draws));
      if (!hadDraw) {
        applyAutoAttach(this._modifierPipeline, saved, undefined, primary);
      }
      // Rebuild GPU from HEAD so impostor pick IDs + frameOffset match the
      // committed frame.
      await this.applyPipeline({ changeKind: "full" });
    }
  }

  /**
   * Discard working-tree edits and restore the scene from committed HEAD
   * (`system.frame`), like `git checkout -- .`. Clears command history.
   * Empty HEAD clears the artist meshes / scene index.
   */
  public discardScene(): void {
    const frame = this._system.frame;
    if (frameHasStructure(frame)) {
      // Force pipeline path so Draw modifiers rebuild GPU state from HEAD.
      void this.applyPipeline({ fullRebuild: true }).catch((error) => {
        logger.error("discardScene applyPipeline failed", error);
      });
    } else {
      // artist.clear() already clears the scene index and re-registers
      // empty atom/bond layers. A second sceneIndex.clear() would leave
      // getAtomState() null so progressive draws fail until the next
      // full replaceScene.
      this.artist.clear();
    }
    this.commandManager.clearHistory();
    this._world.sceneIndex.markAllSaved();
  }

  /**
   * Capture the current viewport as a data URL.
   * Uses BabylonJS render-target screenshot for consistent quality.
   *
   * `autoCrop` trims the output to the tight bounding box of non-transparent
   * pixels and implies `transparentBackground: true` (the alpha channel is the
   * scan source).
   */
  public async screenshot(options?: {
    width?: number;
    height?: number;
    transparentBackground?: boolean;
    format?: "png" | "webp";
    autoCrop?: boolean;
    cropPadding?: number;
    quality?: number;
  }): Promise<string> {
    const width = options?.width ?? this._canvas.width;
    const height = options?.height ?? this._canvas.height;
    const format = options?.format ?? "png";
    const autoCrop = options?.autoCrop ?? false;
    const transparent = autoCrop || (options?.transparentBackground ?? false);
    const savedAlpha = this._world.scene.clearColor.a;

    if (transparent) {
      this._world.scene.clearColor.a = 0;
    }

    try {
      const activeCamera = this._world.scene.activeCamera;
      if (!activeCamera) {
        throw new Error("Cannot capture screenshot without an active camera");
      }
      const raw = await Tools.CreateScreenshotUsingRenderTargetAsync(
        this._engine,
        activeCamera,
        { width, height },
      );
      const needsPostProcess = autoCrop || format !== "png";
      if (!needsPostProcess) return raw;

      const mimeType = format === "webp" ? "image/webp" : "image/png";
      if (autoCrop) {
        return await cropToContent(raw, {
          padding: options?.cropPadding ?? 8,
          mimeType,
          quality: options?.quality ?? 0.92,
        });
      }
      return await reencodeImage(raw, mimeType, options?.quality ?? 0.92);
    } finally {
      if (transparent) {
        this._world.scene.clearColor.a = savedAlpha;
      }
    }
  }

  /**
   * Copy a PNG screenshot of the current viewport to the system clipboard.
   *
   * The `ClipboardItem` is built from a Blob *promise* so the browser keeps the
   * user-gesture activation alive across the async screenshot render — the
   * pattern Chromium requires for `navigator.clipboard.write` to succeed from a
   * menu click. Throws if the async clipboard image API is unavailable; the
   * caller surfaces that as a status message.
   */
  public async copyScreenshotToClipboard(): Promise<void> {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      throw new Error("Clipboard image API is unavailable in this environment");
    }
    const blob = this.screenshot({ format: "png" }).then((dataUrl) =>
      fetch(dataUrl).then((response) => response.blob()),
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }

  /**
   * Render a deterministic turntable rotation around the current scene and
   * return one captured frame per step as a data URL.
   *
   * The camera orbits through a dedicated render camera (see
   * {@link CameraAnimator}), so the user's interactive view is never disturbed.
   * Frame count is `round(duration * fps)` and stepping is counter-driven, so
   * the output is reproducible and independent of the live frame rate. Core
   * emits only image data URLs; GIF/WebM encoding lives in the frontend.
   */
  public async exportTurntable(opts: {
    duration: number;
    fps: number;
    revolutions?: number;
    polarAngle?: number;
    width?: number;
    height?: number;
    transparentBackground?: boolean;
    format?: "png" | "webp";
  }): Promise<string[]> {
    return this._world.cameraAnimator.renderFrames(
      {
        duration: opts.duration,
        fps: opts.fps,
        revolutions: opts.revolutions,
        polarAngle: opts.polarAngle,
      },
      () =>
        this.screenshot({
          width: opts.width,
          height: opts.height,
          transparentBackground: opts.transparentBackground,
          format: opts.format,
        }),
    );
  }

  /**
   * Export the current frame as a self-contained binary glTF (`.glb`) of the
   * ball-and-stick scene — real sphere/cylinder geometry carrying the active
   * theme's colours and radii, viewable in any glTF viewer with zero molvis
   * runtime. Reuses the render buffers, so the model matches what is drawn.
   * See {@link exportFrameToGLB}.
   */
  public async exportGLTF(options?: GltfExportOptions): Promise<Uint8Array> {
    const frame = this.frame;
    if (!frame) throw new Error("exportGLTF: no frame loaded to export");
    return exportFrameToGLB(frame, this._engine, {
      background: this.getBackgroundColor(),
      styleManager: this._styleManager,
      ...options,
    });
  }

  /**
   * Follow atom-anchored overlays from SceneIndex meta (canvas positions).
   * Frame HEAD may lag uncommitted edits; mismatch → skip that overlay.
   */
  private _syncAnchoredOverlays(): void {
    if (this.overlayManager.size === 0) return;
    const atoms = this._world.sceneIndex.metaRegistry.atoms;

    for (const overlay of this.overlayManager.list()) {
      const anchored = asAtomAnchored(overlay);
      if (!anchored) continue;
      const atomId = anchored.getAnchorAtomId();
      if (atomId < 0) continue;
      const meta = atoms.getMeta(atomId);
      if (!meta) {
        logger.warn(
          `anchored overlay ${overlay.id}: atom ${atomId} not on canvas`,
        );
        continue;
      }
      anchored.syncToAtomPosition(
        meta.position.x,
        meta.position.y,
        meta.position.z,
      );
    }
  }

  /**
   * Snap a freshly-added overlay onto its anchor atom on the canvas
   * (SceneIndex). Commands that create anchored overlays should call this
   * once after ``overlayManager.add`` so the mark is positioned
   * synchronously instead of waiting on the next render cycle.
   */
  public syncAnchoredOverlay(overlay: Overlay): void {
    const anchored = asAtomAnchored(overlay);
    if (!anchored) return;
    const atomId = anchored.getAnchorAtomId();
    if (atomId < 0) return;
    const meta = this._world.sceneIndex.metaRegistry.atoms.getMeta(atomId);
    if (!meta) {
      throw new Error(
        `syncAnchoredOverlay: atom ${atomId} is not on the canvas (SceneIndex)`,
      );
    }
    anchored.syncToAtomPosition(
      meta.position.x,
      meta.position.y,
      meta.position.z,
    );
  }

  public destroy(): void {
    this.stop();
    this._resizeCoalesce?.cancel();
    this._resizeCoalesce = null;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    disposeLoadedFile(this);
    for (const source of this._modifierPipeline.sources()) {
      source.dispose();
    }
    this.overlayManager.dispose();
    this._guiManager?.unmount();
    this._lastRenderedFrame = null;
    this._world.dispose();
    if (this._ownsEngine) this._engine.dispose();

    if (this._root.parentElement) {
      this._root.parentElement.removeChild(this._root);
    }

    logger.info("Molvis destroyed and cleaned up");
  }

  public setMode(mode: string): void {
    // ModeType values ARE the canonical mode strings ("view", "select", …).
    // Compare string literals (not Object.values / shared arrays / enum
    // members): under the vsc-ext dual-runtime split those bindings can be
    // null when the module is evaluated on the non-owning runtime.
    // Plugin modes (registered via {@link ModeManager.registerPluginMode})
    // are accepted as any other non-empty string the manager knows.
    if (!this._modeManager) return; // headless: no interaction modes
    if (
      mode === "view" ||
      mode === "select" ||
      mode === "edit" ||
      mode === "measure" ||
      mode === "manipulate"
    ) {
      this._modeManager.switch_mode(mode);
      return;
    }
    if (this._modeManager.listPluginModes().includes(mode)) {
      this._modeManager.switch_mode(mode);
      return;
    }
    logger.warn(`Unknown mode: ${mode}`);
  }

  /**
   * Mode manager (interaction modes). Undefined on headless apps.
   * Plugins register custom modes through this handle.
   */
  get modeManager(): ModeManager | undefined {
    return this._modeManager;
  }

  /**
   * Enter fence (lasso) selection mode. Disables camera, enables drawing.
   * Only works when in Select mode.
   */
  public enterFenceSelect(): void {
    const mode = this._world.mode;
    if (mode instanceof SelectMode) {
      mode.enterFenceMode();
    }
  }

  /**
   * Exit fence selection mode. Re-enables camera.
   */
  public exitFenceSelect(): void {
    const mode = this._world.mode;
    if (mode instanceof SelectMode) {
      mode.exitFenceMode();
    }
  }

  /**
   * Push the live canvas selection into the pipeline as a SelectModifier
   * (for hide / color / named selection). Auto-commits a dirty scene first
   * so ids match HEAD. Highlight is already the selection.
   */
  public async confirmPendingSelection(): Promise<void> {
    const mode = this._world.mode;
    if (mode instanceof SelectMode) {
      await mode.confirmPendingSelection();
    }
  }

  /** Clear the live canvas selection. */
  public clearPendingSelection(): void {
    const mode = this._world.mode;
    if (mode instanceof SelectMode) {
      mode.clearPending();
    } else {
      this._world.selectionManager.apply({ type: "clear" });
    }
  }

  /** Live selected atom count (SelectionManager). */
  public get pendingAtomCount(): number {
    return this._world.selectionManager.getSelectedAtomIds().size;
  }

  /** Live selected bond count (SelectionManager). */
  public get pendingBondCount(): number {
    return this._world.selectionManager.getSelectedBondIds().size;
  }

  public setTheme(theme: Theme): void {
    this._styleManager.setTheme(theme);
    // Full pipeline rebuild so Draw modifiers re-sample element colours
    // (position-only path would leave stale impostor instanceColor buffers).
    void this.applyPipeline({ changeKind: "full" }).catch((error) => {
      logger.error("setTheme applyPipeline failed", error);
    });
  }

  /**
   * Canvas colour as `#RRGGBB`. Read by the categorical palette, which
   * generates type colours that stay clear of whatever the canvas is.
   */
  public getBackgroundColor(): string {
    const c = this._world.scene.clearColor;
    const byte = (v: number) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0");
    return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}`.toUpperCase();
  }

  public setBackgroundColor(color: string): void {
    const hex = color.replace(/^#/, "");
    const r = Number.parseInt(hex.substring(0, 2), 16) / 255;
    const g = Number.parseInt(hex.substring(2, 4), 16) / 255;
    const b = Number.parseInt(hex.substring(4, 6), 16) / 255;
    const a =
      hex.length >= 8 ? Number.parseInt(hex.substring(6, 8), 16) / 255 : 1;
    this._world.scene.clearColor = new Color4(r, g, b, a);
    // Type colours are generated away from the canvas colour, so they are
    // stale the moment it changes. Same reasoning as `setTheme`.
    void this.applyPipeline({ changeKind: "full" }).catch((error) => {
      logger.error("setBackgroundColor applyPipeline failed", error);
    });
  }

  public async setRepresentation(id: RepresentationId): Promise<void> {
    const representation = findRepresentation(id);
    await this.commandManager.execute(
      new SetRepresentationCommand(this, { style: representation }),
    );
  }

  public async setRepresentationOutline(enabled: boolean): Promise<void> {
    const representation = this._styleManager.getRepresentation();
    if (!representation.outlineConfigurable) {
      throw new Error(
        `Representation '${representation.id}' does not expose a configurable outline`,
      );
    }
    this._styleManager.setOutlineEnabled(enabled);
    if (this._system.frame) {
      await this.applyPipeline({ fullRebuild: true });
    } else {
      this.artist.redrawFromSceneIndex();
    }
    this.events.emit(
      "representation-change",
      this._styleManager.getRepresentation(),
    );
  }

  /**
   * Update configuration at runtime.
   * Merges with existing config and propagates changes.
   */
  public setConfig(newConfig: Partial<MolvisConfig>): void {
    this._config = defaultMolvisConfig({ ...this._config, ...newConfig });

    if (newConfig.showUI !== undefined) {
      this._uiOverlay.style.display = this._config.showUI ? "block" : "none";
    }
  }

  /**
   * Queue a trajectory frame render using a "latest-wins" pattern.
   * Rapid calls (e.g. timeline scrubbing) coalesce: only the most recent
   * request executes after the current render finishes, skipping intermediates.
   */
  private queueTrajectoryFrameRender(forceFull = false): void {
    if (!this._isRunning) return;
    this._frameScheduler.request(forceFull);
  }

  /**
   * Render the currently active trajectory frame.
   *
   * Routes through the modifier pipeline so the per-frame work (selection,
   * color, slice, hide, draw…) all executes against the new frame.
   * `FrameDiff.classifyFrameTransition()` decides whether this is a
   * cheap position-only update or a full rebuild; the result is threaded
   * into `PipelineContext.changeKind` so the Draw modifiers can pick the
   * fast or slow path internally.
   */
  private async renderActiveTrajectoryFrame(forceFull = false): Promise<void> {
    const frame = this._system.frame;
    this._currentFrame = this._system.trajectory.currentIndex;

    const atomCount = frame.getBlock("atoms")?.nrows() ?? 0;
    const bondCount = frame.getBlock("bonds")?.nrows() ?? 0;

    const hasGpuState =
      this._world.sceneIndex.meshRegistry.getAtomState() !== null;

    // FrameDiff classifies against `system.frame`, which only carries
    // the primary trajectory's blocks. With 2+ DSes, the bonds block
    // contributed by a topology DS is invisible here and the classifier
    // would always return "position" — DrawBondModifier's fast path
    // would then reuse stale atomi/atomj pairings. Force full until the
    // classifier can run on the synthesized merged frame.
    const isMultiDs = this._modifierPipeline.enabledSourceCount() > 1;

    let decision: FrameTransitionDecision;
    if (forceFull || !hasGpuState || isMultiDs) {
      decision = {
        kind: "full",
        reasons: [
          forceFull
            ? "Forced full rebuild"
            : !hasGpuState
              ? "No GPU state yet"
              : "Multi-DS pipeline; classifier can't see the synthesized frame",
        ],
        stats: { atomCount, bondCount },
      };
    } else {
      decision = classifyFrameTransition(this._lastRenderedFrame, frame);
    }

    const isPositionOnly = decision.kind === "position";
    const selectionSnapshot = isPositionOnly
      ? null
      : captureStructuralSelectionSnapshot(this._world.selectionManager);

    await this.applyPipeline({
      changeKind: isPositionOnly ? "position" : "full",
    });

    if (!isPositionOnly && selectionSnapshot) {
      reconcileSelectionAfterStructuralUpdate(
        this._world.selectionManager,
        decision.kind as Exclude<FrameUpdateKind, "position">,
        selectionSnapshot,
      );
    }
    this._lastRenderedFrame = frame;
  }

  /**
   * Re-render the active pipeline. The frame identifies the active source
   * state; visual style is always read from the app-wide StyleManager.
   */
  private renderFrameInternal(frame: Frame): Promise<void> {
    return this.applyPipeline({ changeKind: "full" }).then(() => {
      this._lastRenderedFrame = frame;
    });
  }

  public renderFrame(frame: Frame): void {
    void this.renderFrameInternal(frame).catch((error) => {
      logger.error("renderFrame failed", error);
    });
  }

  /**
   * Reset the app to its initial empty state.
   *
   * Clears every layer that holds frame-derived or user-authored
   * scene content, then restores boot state: empty pipeline + length-1
   * system trajectory (no Source until the user opens one).
   */
  public reset(): void {
    this._lastRenderedFrame = null;
    this._lastSelectionSet = new Map();

    this._world.selectionManager.clearSelection();
    this._world.highlighter.clearAll();
    this.overlayManager.clear();
    this.artist.clear();
    this.commandManager.clearHistory();
    this._modeManager?.switch_mode(ModeType.View);

    // Empty pipeline; prior DataSources disposed via pipeline.clear.
    this._sceneSession.bootstrapEmptyPrimary();
    this._currentFrame = this._system.trajectory.currentIndex;

    // Fire-and-forget: trigger computed so analysis panels clear themselves.
    void this.applyPipeline({ fullRebuild: true });
  }

  /**
   * Run the modifier pipeline and let the pipeline's Draw modifiers
   * render the result.
   *
   * - `changeKind` is threaded into PipelineContext so Draw modifiers
   *   can pick the fast (position-only) or slow (full rebuild) path.
   * - For a full / topology rebuild we discard stale Highlighter
   *   originals so the pipeline-computed colors win.
   *
   * `fullRebuild: true` aliases to `changeKind: "full"`.
   *
   * The working frame is always built by the pipeline's composition head from
   * the DataSources currently in the pipeline at this `_currentFrame`.
   * Multi-DS contributions (e.g. a topology-only `bonds.dump` stacked on a
   * position-only `traj.lammpstrj`) merge into a single frame for downstream
   * modifiers; a single DS is a zero-config passthrough.
   */
  /**
   * Whether toggling `modifier.enabled` can be a visibility-only update
   * (no pipeline recompute). True for any Draws layer that does not
   * produce selection. False for pure data/selection modifiers (Slice,
   * Wrap PBC, Color by Property, Select, …).
   */
  public static modifierToggleIsVisibilityOnly(modifier: {
    capabilities: ReadonlySet<ModifierCapability>;
  }): boolean {
    const caps = modifier.capabilities;
    if (!caps.has(ModifierCapability.Draws)) return false;
    if (caps.has(ModifierCapability.ProducesSelection)) return false;
    return true;
  }

  /**
   * Set a modifier's enabled flag. Visual layers only flip mesh
   * visibility (instant). Data/selection modifiers re-run the pipeline.
   */
  public async setEntryEnabled(
    entry: PipelineEntry,
    enabled: boolean,
  ): Promise<Frame | null> {
    if (entry.enabled === enabled) {
      return this.system.frame ?? null;
    }
    entry.enabled = enabled;

    // Disabling a source withholds its trajectory from composition, which
    // always needs a recompose — only a drawing modifier can be toggled by
    // flipping mesh visibility alone.
    const modifier = entry instanceof DataSource ? null : (entry as Modifier);
    if (modifier && MolvisApp.modifierToggleIsVisibilityOnly(modifier)) {
      // Same hook applyPipeline uses after compute — no recompose / GPU rebuild.
      modifier.applyVisibility(this, enabled);
      return this.system.frame ?? null;
    }

    return this.applyPipeline({ fullRebuild: true });
  }

  public async applyPipeline(options?: {
    fullRebuild?: boolean;
    changeKind?: FrameChangeKind;
  }): Promise<Frame | null> {
    const changeKind: FrameChangeKind = options?.changeKind ?? "full";

    if (changeKind === "full") {
      this._world.highlighter.discardSavedOriginals();
    }

    const captured: { context: PipelineContext | null } = { context: null };
    const captureContext = ({ context }: { context: PipelineContext }) => {
      captured.context = context;
    };
    this._modifierPipeline.on(PipelineEvents.COMPUTED, captureContext);

    const computed = await this._modifierPipeline.compute(
      this._currentFrame,
      this,
      changeKind,
    );

    this._modifierPipeline.off(PipelineEvents.COMPUTED, captureContext);

    // After all Draw modifiers have registered their layers, flush the
    // accumulated buffer state to the GPU and run the once-per-frame
    // side effects that used to live inside the (now-deleted) drawFrame
    // composer: slice mask upload, dirty bookkeeping, and the public
    // frame-rendered event.
    const renderTarget = computed;
    this.artist.applySceneIndexToMeshes();

    // Reflect each Draws-modifier's enable state on its render layer
    // — has to run *after* applySceneIndexToMeshes because it
    // unconditionally calls setEnabled(true) on layers whose state has
    // data, which would otherwise undo our hide.
    for (const m of this._modifierPipeline.modifiers()) {
      m.applyVisibility(this, m.enabled);
    }
    this.artist.applySliceMaskIfPresent(renderTarget);
    // Pipeline rebuild does not absorb the edit pool. Only clear dirty when
    // there is no edit overlay — otherwise hasUnsavedChanges would lie and
    // get_selected / confirm would treat canvas as clean HEAD.
    const meta = this._world.sceneIndex.metaRegistry;
    if (meta.atoms.edits.size === 0 && meta.bonds.edits.size === 0) {
      this._world.sceneIndex.markAllSaved();
    }
    this.events.emit("frame-rendered", {
      frame: renderTarget,
      box: renderTarget.box ?? undefined,
    });

    // Pipeline selection producers write `selectionSet` only (via COMPUTED).
    // Live canvas SelectionManager is WYSIWYG and must not be clobbered here —
    // fence/click selection survives recompute; named pipeline selections stay
    // in `_lastSelectionSet` for hide/color/analysis consumers.
    const ctx = captured.context;

    // Execute post-render effects registered by modifiers during apply().
    if (ctx) {
      for (const effect of ctx.postRenderEffects) {
        effect();
      }
    }

    return computed;
  }

  /**
   * Replace the whole scene with a single source trajectory.
   *
   * Emits 'trajectory-change' through System.
   */
  public async replaceScene(
    trajectory: Trajectory,
    meta?: DataSourceOptions,
  ): Promise<void> {
    await this._sceneSession.replaceScene(trajectory, meta);
  }

  public async setTrajectory(
    trajectory: Trajectory,
    meta?: DataSourceOptions,
  ): Promise<void> {
    await this.replaceScene(trajectory, meta);
  }

  /**
   * Append one frame to the end of the live trajectory (vs.
   * {@link MolvisApp.setTrajectory}, which replaces it).
   *
   * The streaming ingress: a producer pushes frames as they are computed
   * without resending the run so far and without a pipeline rebuild per step.
   * See {@link SceneSession.appendFrame}.
   */
  public async appendFrame(
    frame: Frame,
    box?: Box,
    meta?: DataSourceOptions,
  ): Promise<{ index: number; installedScene: boolean }> {
    return this._sceneSession.appendFrame(frame, box, meta);
  }

  /**
   * Append an *additional* {@link DataSource} to the pipeline (vs.
   * {@link MolvisApp.setTrajectory}, which replaces the primary source).
   * See {@link SceneSession.addDataSource}.
   */
  public async addDataSource(ds: DataSource): Promise<void> {
    await this._sceneSession.addDataSource(ds);
  }

  /**
   * Remove a {@link DataSource} from the pipeline.
   * See {@link SceneSession.removeDataSource}.
   */
  public async removeDataSource(id: string): Promise<void> {
    await this._sceneSession.removeDataSource(id);
  }

  /**
   * Navigate to the next frame. Async to support streaming trajectories;
   * fire-and-forget callers don't need to await — `frame-change` events
   * still drive the rest of the system.
   */
  public async nextFrame(): Promise<void> {
    if (await this._system.nextFrame()) {
      this._currentFrame = this._system.trajectory.currentIndex;
      this.queueTrajectoryFrameRender();
    }
  }

  /**
   * Navigate to the previous frame.
   */
  public async prevFrame(): Promise<void> {
    if (await this._system.prevFrame()) {
      this._currentFrame = this._system.trajectory.currentIndex;
      this.queueTrajectoryFrameRender();
    }
  }

  /**
   * Seek to a specific frame index.
   */
  public async seekFrame(index: number): Promise<void> {
    if (await this._system.seekFrame(index)) {
      this._currentFrame = this._system.trajectory.currentIndex;
      this.queueTrajectoryFrameRender();
    }
  }
}
