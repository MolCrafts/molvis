import { Color4, Engine, Tools } from "@babylonjs/core";
import { Artist } from "./artist";
import { findRepresentation } from "./artist/representation";
import { StyleManager } from "./artist/style_manager";
import type { Theme } from "./artist/theme";
import {
  type CommandRegistry,
  commands,
  registerDefaultCommands,
} from "./commands";
import type { DrawFrameOption } from "./commands/draw";
import { CommandManager } from "./commands/manager";
import { SetRepresentationCommand } from "./commands/representation";
import { type MolvisConfig, defaultMolvisConfig } from "./config";
import { EventEmitter, type MolvisEventMap } from "./events";
import { viewAtomCoords } from "./io/atom_coords";
import { ModeManager, ModeType } from "./mode";
import { SelectMode } from "./mode/select";
import type { HitResult } from "./mode/types";
import { ModifierPipeline, PipelineEvents } from "./pipeline";
import { applyAutoAttach } from "./pipeline/auto_attach";
import {
  DataSourceModifier,
  TrajectoryDataSource,
} from "./pipeline/data_source_modifier";
import { registerDefaultModifiers } from "./pipeline/modifier_registry";
import type {
  FrameChangeKind,
  PipelineContext,
  SelectionMask,
} from "./pipeline/types";
import { syncSceneToFrame } from "./scene_sync";
import { type MolvisSetting, Settings } from "./settings";
import { System } from "./system";
import {
  type FrameTransitionDecision,
  type FrameUpdateKind,
  classifyFrameTransition,
} from "./system/frame_diff";
import { Trajectory } from "./system/trajectory";
import { GUIManager } from "./ui/manager";
import { cropToContent, reencodeImage } from "./utils/image_crop";
import { logger } from "./utils/logger";
import { MOLVIS_VERSION } from "./version";
import { World } from "./world";

import { type Box, Frame } from "@molcrafts/molrs";
import { createMolvisDOM, registerWebComponents } from "./dom_helpers";
import { OverlayManager } from "./overlays/overlay_manager";
import type { AtomAnchored, Overlay } from "./overlays/types";
import { defaultSaveFile } from "./save_file";
import { DType } from "./utils/dtype";

interface StructuralSelectionSnapshot {
  atomIds: number[];
  hasExpressionSelection: boolean;
}

function asAtomAnchored(overlay: Overlay): AtomAnchored | null {
  const a = overlay as Partial<AtomAnchored>;
  return typeof a.getAnchorAtomId === "function" &&
    typeof a.syncToAtomPosition === "function"
    ? (a as AtomAnchored)
    : null;
}

export class MolvisApp {
  // DOM elements
  private _container: HTMLElement;
  private _root: HTMLElement;
  private _canvas: HTMLCanvasElement;
  private _uiOverlay: HTMLElement;

  // Core components
  private _config: MolvisConfig;
  private _engine: Engine;
  private _world: World;
  private _system: System;
  private _modeManager!: ModeManager;
  private _guiManager!: GUIManager;
  private _isRunning = false;
  private _rendererReady = true;

  // Pipelines
  private _modifierPipeline: ModifierPipeline;
  private _currentFrame = 0;
  private _sourceFrame: Frame | null = null; // original frame, never overwritten by pipeline
  private _lastRenderedFrame: Frame | null = null;
  private _lastSelectionSet: Map<string, SelectionMask> = new Map();
  private _frameRenderQueue: Promise<void> = Promise.resolve();
  private _pendingFrameRender: { forceFull: boolean } | null = null;

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
    container: HTMLElement,
    config: MolvisConfig = {},
    setting?: Partial<MolvisSetting>,
  ) {
    this._config = defaultMolvisConfig(config);
    this._container = container;
    logger.info(`Molvis initializing (v${MOLVIS_VERSION})`);

    // Ensure default command/modifier registries are populated. Both are
    // idempotent; subsequent calls are no-ops.
    registerDefaultCommands();
    registerDefaultModifiers();

    // Register Web Components & create DOM
    registerWebComponents();
    const dom = createMolvisDOM(this._container, this._config);
    this._root = dom.root;
    this._canvas = dom.canvas;
    this._uiOverlay = dom.uiOverlay;

    // Initialize Babylon engine
    this._engine = new Engine(
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

    // Initialize GUI
    this._guiManager = new GUIManager(this._container, this, this._config);
    this._guiManager.mount();

    // Initialize default mode (View mode)
    this._modeManager = new ModeManager(this);
    this._modeManager.switch_mode(ModeType.View);
    this._world.setMode(this._modeManager);

    // Initialize modifier pipeline
    this._modifierPipeline = new ModifierPipeline();

    // Initialize Artist (Drawing Logic)
    this.artist = new Artist({ app: this });

    // Initialize command registry (use shared singleton)
    this.commands = commands;

    // Initialize Command Manager
    this.commandManager = new CommandManager(this);

    // Wire scene-level dirty tracking to event bus
    this._world.sceneIndex.onDirtyChange = (isDirty: boolean) => {
      this.events.emit("dirty-change", isDirty);
    };

    // Store named selections for analysis tools (RDF, etc.).
    // Selection-to-scene sync is handled exclusively in applyPipeline().
    this._modifierPipeline.on(PipelineEvents.COMPUTED, ({ context }) => {
      this._lastSelectionSet = new Map(context.selectionSet);
    });

    // Sync atom-anchored overlays (text labels, highlight halos, ...) on each
    // frame render so they follow their atom across the trajectory.
    this.events.on("frame-rendered", ({ frame }) => {
      this._syncAnchoredOverlays(frame);
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

  /** Named selections from the last pipeline run. */
  get selectionSet(): ReadonlyMap<string, SelectionMask> {
    return this._lastSelectionSet;
  }

  get styleManager(): StyleManager {
    return this._styleManager;
  }

  get gui(): GUIManager {
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
  ): Promise<HitResult> {
    return this._world.picker.pick(pointerX, pointerY);
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

  public resetCamera(): void {
    this._world.resetCamera();
  }

  public save(): void {
    const frame = this._system.frame;
    if (frame) {
      syncSceneToFrame(this._world.sceneIndex, frame);
    }
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

  private _syncAnchoredOverlays(frame: Frame): void {
    const atoms = frame.getBlock("atoms");
    if (!atoms) return;
    const coords = viewAtomCoords(atoms);
    const x = coords?.x;
    const y = coords?.y;
    const z = coords?.z;
    if (!x || !y || !z) return;

    for (const overlay of this.overlayManager.list()) {
      const anchored = asAtomAnchored(overlay);
      if (!anchored) continue;
      const atomId = anchored.getAnchorAtomId();
      if (atomId < 0 || atomId >= x.length) continue;
      anchored.syncToAtomPosition(x[atomId], y[atomId], z[atomId]);
    }
  }

  public destroy(): void {
    this.stop();
    this.overlayManager.dispose();
    this._guiManager.unmount();
    this._lastRenderedFrame = null;
    this._pendingFrameRender = null;
    this._engine.dispose();

    if (this._root.parentElement) {
      this._root.parentElement.removeChild(this._root);
    }

    logger.info("Molvis destroyed and cleaned up");
  }

  public setMode(mode: string): void {
    switch (mode) {
      case "view":
        this._modeManager.switch_mode(ModeType.View);
        break;
      case "select":
        this._modeManager.switch_mode(ModeType.Select);
        break;
      case "edit":
        this._modeManager.switch_mode(ModeType.Edit);
        break;
      case "measure":
        this._modeManager.switch_mode(ModeType.Measure);
        break;
      case "manipulate":
        this._modeManager.switch_mode(ModeType.Manipulate);
        break;
      default:
        logger.warn(`Unknown mode: ${mode}`);
        break;
    }
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
   * Confirm the pending manual selection by committing it as a SelectModifier.
   * Only works when in Select mode.
   */
  public confirmPendingSelection(): void {
    const mode = this._world.mode;
    if (mode instanceof SelectMode) {
      mode.confirmPendingSelection();
    }
  }

  /**
   * Clear the pending selection without committing.
   * Only works when in Select mode.
   */
  public clearPendingSelection(): void {
    const mode = this._world.mode;
    if (mode instanceof SelectMode) {
      mode.clearPending();
    }
  }

  public setTheme(theme: Theme): void {
    this._styleManager.setTheme(theme);
    if (this._system.frame) {
      this.renderFrame(this._system.frame);
    }
  }

  public setBackgroundColor(color: string): void {
    const hex = color.replace(/^#/, "");
    const r = Number.parseInt(hex.substring(0, 2), 16) / 255;
    const g = Number.parseInt(hex.substring(2, 4), 16) / 255;
    const b = Number.parseInt(hex.substring(4, 6), 16) / 255;
    const a =
      hex.length >= 8 ? Number.parseInt(hex.substring(6, 8), 16) / 255 : 1;
    this._world.scene.clearColor = new Color4(r, g, b, a);
  }

  public setRepresentation(name: string): void {
    const repr = findRepresentation(name);
    if (repr) {
      void this.commandManager.execute(
        new SetRepresentationCommand(this, { style: repr }),
      );
    }
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

    // If a render is already queued, upgrade to forceFull if requested.
    if (this._pendingFrameRender) {
      if (forceFull) this._pendingFrameRender.forceFull = true;
      return;
    }

    this._pendingFrameRender = { forceFull };
    this._frameRenderQueue = this._frameRenderQueue
      .catch(() => {
        // Previous render failure is already logged; keep queue alive.
      })
      .then(async () => {
        // Drain the pending request (latest wins).
        const pending = this._pendingFrameRender;
        this._pendingFrameRender = null;
        if (pending) {
          await this.renderActiveTrajectoryFrame(pending.forceFull);
        }
      })
      .catch((error) => {
        logger.error("Failed to render trajectory frame", error);
      });
  }

  private captureStructuralSelectionSnapshot(): StructuralSelectionSnapshot {
    const selection = this._world.selectionManager;
    return {
      atomIds: [...selection.getSelectedAtomIds()],
      hasExpressionSelection: selection.hasExpressionSelectionContext(),
    };
  }

  private reconcileSelectionAfterStructuralUpdate(
    updateKind: Exclude<FrameUpdateKind, "position">,
    snapshot: StructuralSelectionSnapshot,
  ): void {
    const selection = this._world.selectionManager;

    if (snapshot.hasExpressionSelection) {
      const rehydrated = selection.reapplyLastExpression();
      if (!rehydrated) {
        selection.clearSelection();
      }
      return;
    }

    if (updateKind === "bond" && snapshot.atomIds.length > 0) {
      selection.replaceAtomsByIds(snapshot.atomIds);
      return;
    }

    selection.clearSelection();
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
    // classifier can run on the post-phase-A merged frame.
    const isMultiDs = this._modifierPipeline.enabledDataSourceCount() > 1;

    let decision: FrameTransitionDecision;
    if (forceFull || !hasGpuState || isMultiDs) {
      decision = {
        kind: "full",
        reasons: [
          forceFull
            ? "Forced full rebuild"
            : !hasGpuState
              ? "No GPU state yet"
              : "Multi-DS pipeline; classifier can't see merged phase A frame",
        ],
        stats: { atomCount, bondCount },
      };
    } else {
      decision = classifyFrameTransition(this._lastRenderedFrame, frame);
    }

    const isPositionOnly = decision.kind === "position";
    const selectionSnapshot = isPositionOnly
      ? null
      : this.captureStructuralSelectionSnapshot();

    await this.applyPipeline({
      changeKind: isPositionOnly ? "position" : "full",
    });

    if (!isPositionOnly && selectionSnapshot) {
      this.reconcileSelectionAfterStructuralUpdate(
        decision.kind as Exclude<FrameUpdateKind, "position">,
        selectionSnapshot,
      );
    }
    this._lastRenderedFrame = frame;
  }

  /**
   * Render a frame: route through the modifier pipeline. The `frame`
   * parameter is retained for the public {@link renderFrame} signature
   * but isn't passed as a phase-A override anymore — the pipeline now
   * builds its working frame from its own DataSources at
   * `_currentFrame`. All current callers pass `system.frame`, which
   * matches what phase A would produce for a single-DS pipeline; for
   * multi-DS the merged frame supersedes whatever the caller hands in.
   */
  private renderFrameInternal(
    frame: Frame,
    _box?: Box,
    _options?: DrawFrameOption,
  ): Promise<void> {
    return this.applyPipeline({ changeKind: "full" }).then(() => {
      this._lastRenderedFrame = frame;
    });
  }

  public renderFrame(frame: Frame, box?: Box, options?: DrawFrameOption): void {
    void this.renderFrameInternal(frame, box, options).catch((error) => {
      logger.error("renderFrame failed", error);
    });
  }

  /**
   * Reset the app to its initial empty state.
   *
   * Clears every layer that holds frame-derived or user-authored
   * scene content:
   *   - pipeline modifiers (also disposes streaming workers / OPFS
   *     handles via `DataSourceModifier.dispose`)
   *   - artist meshes (atoms / bonds / cloud / box / ribbon / labels —
   *     this happens twice, once here and once inside `setTrajectory`,
   *     but `artist.clear` is idempotent)
   *   - user-placed overlays (markers, vectors, measurement annotations)
   *   - selection state and selection-derived highlights
   *   - command history
   *
   * Each clear is called *explicitly* rather than relying on
   * `setTrajectory`'s side effects — that decoupling lets future
   * refactors of the trajectory plumbing not silently break the reset
   * contract.
   */
  public reset(): void {
    this._modifierPipeline.clear();
    this._world.selectionManager.clearSelection();
    this._world.highlighter.clearAll();
    this.overlayManager.clear();
    this.artist.clear();
    this.commandManager.clearHistory();
    this._modeManager.switch_mode(ModeType.View);
    void this.setTrajectory(new Trajectory([new Frame()]));
    this._lastSelectionSet = new Map();
  }

  /**
   * Run the modifier pipeline and let the pipeline's Draw modifiers
   * render the result.
   *
   * - `changeKind` is threaded into PipelineContext so Draw modifiers
   *   can pick the fast (position-only) or slow (full rebuild) path.
   * - `sourceFrame`: opt-in override that bypasses pipeline phase A and
   *   feeds the supplied frame straight to phase B. Used by
   *   manipulate-mode rollback flows (`discardChanges`) that materialize
   *   an off-pipeline frame for redraw without touching the DS cache.
   *   New code should NOT reach for it — let phase A merge from DSs.
   * - For a full / topology rebuild we discard stale Highlighter
   *   originals so the pipeline-computed colors win.
   *
   * `fullRebuild: true` is accepted for backward-compat and aliases to
   * `changeKind: "full"`.
   *
   * Phase A merge path is the default now: the working frame is built
   * from the DataSources currently in the pipeline at this
   * `_currentFrame`. Multi-DS contributions (e.g. a topology-only
   * `bonds.dump` stacked on a position-only `traj.lammpstrj`) merge into
   * a single frame for downstream modifiers. For a single DS this
   * matches the previous `_sourceFrame` behavior bit-for-bit.
   */
  public async applyPipeline(options?: {
    fullRebuild?: boolean;
    changeKind?: FrameChangeKind;
    sourceFrame?: Frame;
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

    // Forward an explicit override only — the previous implicit
    // `_sourceFrame ?? _system.frame` fallback masked multi-DS phase-A
    // merging in every common code path, so it's gone. Callers that
    // want phase A get phase A; callers that want a one-shot override
    // (manipulate-mode rollback, tests) still ask for it.
    const computed = await this._modifierPipeline.compute(
      this._currentFrame,
      this,
      changeKind,
      options?.sourceFrame,
    );

    this._modifierPipeline.off(PipelineEvents.COMPUTED, captureContext);

    // After all Draw modifiers have registered their layers, flush the
    // accumulated buffer state to the GPU and run the once-per-frame
    // side effects that used to live inside the (now-deleted) drawFrame
    // composer: auxiliary layers, slice mask upload, dirty bookkeeping,
    // and the public frame-rendered event.
    const renderTarget = computed;
    this.artist.applySceneIndexToMeshes();
    this.artist.renderAuxiliaryLayers(renderTarget);

    // Reflect each Draws-modifier's enable state on its render layer
    // — has to run *after* applySceneIndexToMeshes / renderAuxiliaryLayers
    // because both unconditionally call setEnabled(true) on layers
    // whose state has data, which would otherwise undo our hide.
    for (const m of this._modifierPipeline.getModifiers()) {
      m.applyVisibility(this, m.enabled);
    }
    this.artist.applySliceMaskIfPresent(renderTarget);
    this._world.sceneIndex.markAllSaved();
    this.events.emit("frame-rendered", {
      frame: renderTarget,
      box: renderTarget.simbox ?? undefined,
    });

    // Unified selection sync — single path, no duplication
    const ctx = captured.context;
    if (ctx && ctx.selectionSet.size > 0) {
      const mask = ctx.currentSelection;
      if (mask) {
        const atomKeys: string[] = [];
        for (const idx of mask.getIndices()) {
          const key = this._world.sceneIndex.getSelectionKeyForAtom(idx);
          if (key) atomKeys.push(key);
        }
        const bondKeys: string[] = [];
        for (const bondId of ctx.selectedBondIds) {
          const keys = this._world.sceneIndex.getSelectionKeysForBond(bondId);
          for (const key of keys) bondKeys.push(key);
        }
        // Always sync selection data (for other modifiers to reference)
        this._world.selectionManager.apply({
          type: "replace",
          atoms: atomKeys,
          bonds: bondKeys,
        });
        // If highlight is suppressed, remove the visual overlay but keep selection
        if (ctx.suppressHighlight) {
          this._world.highlighter.clearAll();
        }
      }
    } else {
      this._world.selectionManager.clearSelection();
    }

    // Execute post-render effects registered by modifiers during apply().
    if (ctx) {
      for (const effect of ctx.postRenderEffects) {
        effect();
      }
    }

    return computed;
  }

  /**
   * Set the current trajectory. Replaces any existing data source in
   * the pipeline with a single `TrajectoryDataSource(trajectory)` so
   * the pipeline's phase-A merge has data to draw from. Provenance
   * (`sourceType` / `filename`) is preserved from the previous DS if
   * one existed; otherwise the caller (typically a file ingress
   * function or an RPC handler) is expected to update it via
   * `ensureDataSource` after this call returns.
   *
   * Emits 'trajectory-change' through System.
   */
  public async setTrajectory(trajectory: Trajectory): Promise<void> {
    this.artist.clear();
    this.commandManager.clearHistory();

    // Sync the pipeline: replace any existing DataSourceModifier with a
    // fresh TrajectoryDataSource wrapping the new trajectory. This is
    // the push-side of the multi-DS spec's "system.trajectory derives
    // from pipeline DSs" invariant — task #5 will replace this with a
    // proper addDataSource()/removeDataSource() lifecycle.
    const existingDS = this._modifierPipeline
      .getModifiers()
      .find((m): m is DataSourceModifier => m instanceof DataSourceModifier);
    // Carry sourceType + filename forward; do NOT carry contributedBlocks
    // — the empty default ("everything the new frame has") is correct
    // for a freshly-installed trajectory, and the old DS's narrowing
    // filter doesn't describe the new data shape.
    const carriedMeta = existingDS
      ? {
          sourceType: existingDS.sourceType,
          filename: existingDS.filename,
        }
      : undefined;
    if (existingDS) {
      this._modifierPipeline.removeModifier(existingDS.id);
      // Dispose only when the predecessor was a Trajectory DS — its
      // owned trajectory is being replaced. FrameDataSource placeholders
      // installed by `ensureDataSource` wrap a transient empty Frame
      // which the molrs FinalizationRegistry will GC; calling `free()`
      // here is unnecessary and races with consumers that may still
      // hold a reference between events.
      if (existingDS instanceof TrajectoryDataSource) {
        existingDS.dispose();
      }
    }
    const newDS = new TrajectoryDataSource(trajectory, carriedMeta);
    this._modifierPipeline.addModifier(newDS);
    if (this._modifierPipeline.getModifiers().indexOf(newDS) > 0) {
      this._modifierPipeline.reorderModifier(newDS.id, 0);
    }

    // Use the async setter — it handles both sync trajectories
    // (resolves immediately) and streaming worker-backed ones
    // (awaits frame 0 before priming the System cache).
    await this._system.setTrajectory(trajectory);
    this._currentFrame = this._system.trajectory.currentIndex;
    this._sourceFrame = this._system.frame;
    this._lastRenderedFrame = null;

    if (this._isRunning) {
      await this.renderActiveTrajectoryFrame(true);
    }
  }

  /**
   * Append a {@link DataSourceModifier} to the pipeline.
   *
   * Multi-data-source semantics (`docs/specs/multi-data-source-pipeline.md`):
   *
   * - For a {@link TrajectoryDataSource}, frame count must match every
   *   existing TrajectoryDataSource already in the pipeline. Mismatches
   *   throw with a concrete message; callers (typically the io loaders
   *   from task #6) catch and surface to the user.
   * - {@link FrameDataSource}s are always safe to append (they
   *   broadcast across the system's frame count).
   * - Auto-attach runs against this DS's frame 0 so default Draw
   *   modifiers (DrawAtom / DrawBond / DrawBox) get installed for new
   *   block kinds the source contributes.
   * - If this is the *first* TrajectoryDataSource in the pipeline,
   *   System adopts its trajectory so navigation, frame-change events,
   *   and the existing seek state machine all keep working.
   *
   * No-op for callers wanting "replace everything" — use
   * {@link MolvisApp.setTrajectory} for that legacy path.
   */
  public async addDataSource(ds: DataSourceModifier): Promise<void> {
    if (ds instanceof TrajectoryDataSource) {
      const existingTraj = this._modifierPipeline
        .getModifiers()
        .find(
          (m): m is TrajectoryDataSource => m instanceof TrajectoryDataSource,
        );
      if (existingTraj && existingTraj.frameCount !== ds.frameCount) {
        throw new Error(
          `Cannot add data source: file has ${ds.frameCount} frame(s); existing trajectory has ${existingTraj.frameCount}. File must be single-frame (topology) or match existing frame count.`,
        );
      }
    }

    this._modifierPipeline.addModifier(ds);

    // If this is the first TrajectoryDS, promote System to follow it.
    // Earlier FrameDataSources stay in place and broadcast across the
    // newly grown timeline (their `getFrame(_)` ignores the index).
    if (ds instanceof TrajectoryDataSource) {
      const trajDSs = this._modifierPipeline
        .getModifiers()
        .filter(
          (m): m is TrajectoryDataSource => m instanceof TrajectoryDataSource,
        );
      const isFirstTraj = trajDSs.length === 1;
      if (isFirstTraj) {
        await this._system.setTrajectory(ds.trajectory);
        this._currentFrame = this._system.trajectory.currentIndex;
        this._sourceFrame = this._system.frame;
        this._lastRenderedFrame = null;
      }
    }

    // Auto-attach Draw modifiers based on what this DS contributes.
    // Pre-load frame 0 so matches() can introspect the source frame.
    // Pass the DS as parent so the new Draws nest under it in the UI
    // tree (multi-DS spec phase 2 — purely organizational, no
    // selection semantics).
    await ds.preload(0);
    applyAutoAttach(this._modifierPipeline, ds.cachedFrame, undefined, ds);

    if (this._isRunning) {
      await this.applyPipeline({ fullRebuild: true });
    }
  }

  /**
   * Remove a {@link DataSourceModifier} from the pipeline. Cascades
   * through children (Draw modifiers nested under this DS in phase 2
   * of the spec) via the existing {@link ModifierPipeline.removeModifier}
   * semantics. Disposes the DS's WASM resources.
   *
   * Per the spec's 1a delete-rebuild semantics, removing a
   * TrajectoryDataSource:
   * - If another TrajectoryDataSource remains, System adopts its
   *   trajectory; the system's frame count tracks that new primary.
   * - If none remain, System collapses to a single empty frame so
   *   navigation state stays well-defined (the pipeline still
   *   produces an empty Frame from phase A).
   *
   * Throws if `id` does not refer to a DataSourceModifier in the
   * pipeline. Use {@link ModifierPipeline.removeModifier} directly for
   * non-DS modifiers (Select / Hide / Color / Draws / etc.).
   */
  public async removeDataSource(id: string): Promise<void> {
    const target = this._modifierPipeline
      .getModifiers()
      .find(
        (m): m is DataSourceModifier =>
          m.id === id && m instanceof DataSourceModifier,
      );
    if (!target) {
      throw new Error(`No DataSourceModifier with id '${id}' in pipeline`);
    }

    const removed = this._modifierPipeline.removeModifier(id);
    for (const m of removed) {
      if (m instanceof DataSourceModifier) m.dispose();
    }

    // Wipe scene state before re-running the pipeline. When the
    // removed DS was the only contributor of atoms / bonds, phase A
    // produces an empty frame and the Draw modifiers' `matches()`
    // returns false — they never run, so without this `clear()` the
    // previously-uploaded GPU buffers would survive in the scene
    // forever. If other DSes remain, `applyPipeline` below
    // repopulates from their cached frames.
    this.artist.clear();

    // Re-derive system trajectory from what's left.
    if (target instanceof TrajectoryDataSource) {
      const remainingTraj = this._modifierPipeline
        .getModifiers()
        .find(
          (m): m is TrajectoryDataSource => m instanceof TrajectoryDataSource,
        );
      if (remainingTraj) {
        await this._system.setTrajectory(remainingTraj.trajectory);
      } else {
        // No trajectory anywhere: collapse to a single empty frame so
        // navigation state stays consistent. Any FrameDataSource left
        // in the pipeline still contributes blocks during phase A.
        await this._system.setTrajectory(new Trajectory([new Frame()]));
      }
      this._currentFrame = this._system.trajectory.currentIndex;
      this._sourceFrame = this._system.frame;
      this._lastRenderedFrame = null;
    }

    if (this._isRunning) {
      await this.applyPipeline({ fullRebuild: true });
    }
  }

  /**
   * Navigate to the next frame. Async to support streaming trajectories;
   * fire-and-forget callers don't need to await — `frame-change` events
   * still drive the rest of the system.
   */
  public async nextFrame(): Promise<void> {
    if (await this._system.nextFrame()) {
      this._currentFrame = this._system.trajectory.currentIndex;
      this._sourceFrame = this._system.frame;
      this.queueTrajectoryFrameRender();
    }
  }

  /**
   * Navigate to the previous frame.
   */
  public async prevFrame(): Promise<void> {
    if (await this._system.prevFrame()) {
      this._currentFrame = this._system.trajectory.currentIndex;
      this._sourceFrame = this._system.frame;
      this.queueTrajectoryFrameRender();
    }
  }

  /**
   * Seek to a specific frame index.
   */
  public async seekFrame(index: number): Promise<void> {
    if (await this._system.seekFrame(index)) {
      this._currentFrame = this._system.trajectory.currentIndex;
      this._sourceFrame = this._system.frame;
      this.queueTrajectoryFrameRender();
    }
  }
}
