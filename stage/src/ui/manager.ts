import type { MolvisApp } from "../app";
import type { MolvisConfig } from "../config";
import type { ModeId } from "../mode";
import type { BondColumnMapping } from "../pipeline/bond_column_remap";
import type { Trajectory } from "../system/trajectory";
import { MolvisBondMappingDialog } from "./dialogs/bond_mapping_dialog";
import { InfoPanel } from "./panels/info_panel";
import { ModePanel } from "./panels/mode_panel";
import { PerfPanel } from "./panels/perf_panel";
import { type StatusBeat, StatusPanel } from "./panels/status_panel";
import { MolvisTrajectoryPanel } from "./panels/trajectory_panel";
import { ViewPanel } from "./panels/view_panel";
import { MOLVIS_UI_CSS } from "./styles";

/**
 * GUIManager - manages all UI overlay components
 */
export class GUIManager {
  private container: HTMLElement;
  private app: MolvisApp;
  private config: MolvisConfig;
  private uiOverlay: HTMLElement | null = null;
  private layoutObserver: ResizeObserver | null = null;

  // Components
  private infoPanel: InfoPanel | null = null;
  private modePanel: ModePanel | null = null;
  private viewPanel: ViewPanel | null = null;
  private perfPanel: PerfPanel | null = null;
  private statusPanel: StatusPanel | null = null;
  private trajectoryPanel: MolvisTrajectoryPanel | null = null;
  /** Built on first prompt — most sessions never need a column mapping. */
  private bondMappingDialog: MolvisBondMappingDialog | null = null;

  // Playback state
  private playbackInterval: ReturnType<typeof setInterval> | null = null;
  private playbackSpeed = 100; // ms per frame
  private readonly infoChangeHandler = (text: string) =>
    this.handleInfoChange(text);
  private readonly statusMessageHandler = (beat: StatusBeat) =>
    this.statusPanel?.update(beat);
  private readonly modeChangeHandler = (mode: ModeId) =>
    this.handleModeChange(mode);
  private readonly fpsChangeHandler = (fps: number) =>
    this.handleFpsChange(fps);
  private readonly showFpsChangeHandler = (show: boolean) =>
    this.handleShowFpsChange(show);
  private readonly trajectoryChangeHandler = (trajectory: Trajectory) =>
    this.handleTrajectoryChange(trajectory);
  private readonly frameChangeHandler = (index: number) =>
    this.handleFrameChange(index);
  private readonly lengthChangeHandler = (event: {
    indexedLength: number;
    indexComplete: boolean;
  }) => this.handleLengthChange(event);

  constructor(container: HTMLElement, app: MolvisApp, config: MolvisConfig) {
    this.container = container;
    this.app = app;
    this.config = config;
  }

  /**
   * Mount GUI to DOM
   */
  public mount(): void {
    if (!this.config || this.config.showUI === false) {
      return;
    }

    // Register custom elements first
    if (!customElements.get("molvis-trajectory-panel")) {
      customElements.define("molvis-trajectory-panel", MolvisTrajectoryPanel);
    }
    if (!customElements.get("molvis-bond-mapping-dialog")) {
      customElements.define(
        "molvis-bond-mapping-dialog",
        MolvisBondMappingDialog,
      );
    }

    this.injectStyles();
    this.createOverlay();
    this.initComponents();
    this.setupEventListeners();
  }

  /**
   * Unmount GUI from DOM
   */
  public unmount(): void {
    this.removeEventListeners();
    this.stopPlayback();

    if (this.infoPanel) {
      this.infoPanel.unmount();
      this.infoPanel = null;
    }

    if (this.modePanel) {
      this.modePanel.unmount();
      this.modePanel = null;
    }

    if (this.viewPanel) {
      this.viewPanel.unmount();
      this.viewPanel = null;
    }

    if (this.perfPanel) {
      this.perfPanel.unmount();
      this.perfPanel = null;
    }

    if (this.statusPanel) {
      this.statusPanel.unmount();
      this.statusPanel = null;
    }

    if (this.trajectoryPanel) {
      this.trajectoryPanel.remove();
      this.trajectoryPanel = null;
    }

    if (this.bondMappingDialog) {
      // Unblock a load still awaiting the modal, or its promise never settles.
      this.bondMappingDialog.close(null);
      this.bondMappingDialog.remove();
      this.bondMappingDialog = null;
    }

    if (this.uiOverlay) {
      this.uiOverlay.remove();
      this.uiOverlay = null;
    }

    if (this.layoutObserver) {
      this.layoutObserver.disconnect();
      this.layoutObserver = null;
    }
  }

  /**
   * Inject stage UI CSS where the overlay lives.
   *
   * Standalone mounts put panels in the light DOM → `document.head`.
   * Jupyter / notebook embeds mount inside a ShadowRoot (page
   * `useShadowDOM: true`); styles on `document.head` never pierce the
   * shadow tree, so the info panel stays `display:none` (or unstyled)
   * and hover atom text never becomes visible. Always inject into the
   * container's root node as well.
   */
  private injectStyles(): void {
    const styleId = "molvis-ui-styles";
    const targets: ParentNode[] = [];
    if (typeof document !== "undefined" && document.head) {
      targets.push(document.head);
    }
    const rootNode = this.container.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      targets.push(rootNode);
    }

    for (const target of targets) {
      if (
        target instanceof Document
          ? target.getElementById(styleId)
          : target.querySelector(`#${styleId}`)
      ) {
        continue;
      }
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = MOLVIS_UI_CSS;
      target.appendChild(style);
    }
  }

  /**
   * Attach UI panels to the app's overlay (child of ``.molvis-root``).
   *
   * Do **not** create a second overlay on the host container: that host is
   * often still ``position: static``, so absolute panels fly to the page
   * corner. ``createMolvisDOM`` already owns one overlay on the relative root.
   */
  private createOverlay(): void {
    const owned = this.app.uiContainer;
    if (owned?.isConnected) {
      this.uiOverlay = owned;
      this.uiOverlay.id = "molvis-ui-overlay";
      this.uiOverlay.className = "molvis-ui-overlay";
      this.uiOverlay.style.pointerEvents = "none";
      return;
    }
    // Fallback for unusual hosts that never went through createMolvisDOM.
    this.uiOverlay = document.createElement("div");
    this.uiOverlay.id = "molvis-ui-overlay";
    this.uiOverlay.className = "molvis-ui-overlay";
    const host = this.container;
    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }
    host.appendChild(this.uiOverlay);
  }

  /**
   * Initialize all UI components
   */
  private initComponents(): void {
    if (!this.uiOverlay) return;

    const components = this.config.ui;
    if (!components) return;

    // InfoPanel (bottom-left)
    if (components.showInfoPanel) {
      this.infoPanel = new InfoPanel(this.app);
      this.infoPanel.mount(this.uiOverlay);
    }

    // ModePanel (top-right)
    if (components.showModePanel) {
      this.modePanel = new ModePanel(this.app);
      this.modePanel.mount(this.uiOverlay);
    }

    // ViewPanel (top-left)
    if (components.showViewPanel) {
      this.viewPanel = new ViewPanel(this.app);
      this.viewPanel.mount(this.uiOverlay);
    }

    if (components.showPerfPanel) {
      this.perfPanel = new PerfPanel(this.app);
      this.perfPanel.mount(this.uiOverlay);
      this.handleShowFpsChange(this.app.settings.getShowFps());
    }

    // Status is not optional chrome: without it the stage has no renderer for
    // `status-message` at all, which is how a long load or an optimize run
    // reports itself.
    this.statusPanel = new StatusPanel();
    this.statusPanel.mount(this.uiOverlay);

    // TrajectoryPanel (bottom-center, auto-show)
    if (components.showTrajPanel) {
      this.trajectoryPanel = document.createElement(
        "molvis-trajectory-panel",
      ) as MolvisTrajectoryPanel;
      this.uiOverlay.appendChild(this.trajectoryPanel);

      // Scanning first: a 1-frame boot must not hide the HUD before
      // `length-changed` arrives. Order matters — `length` triggers readout.
      this.trajectoryPanel.scanning = !this.app.system.trajectory.indexComplete;
      this.trajectoryPanel.length = this.app.system.trajectory.indexedLength;
      this.trajectoryPanel.current = this.app.system.trajectory.currentIndex;
      this.trajectoryPanel.playing = false;
      this.updateTrajectoryPanelLayout();

      // Bind panel events
      this.trajectoryPanel.addEventListener("seek", (e: Event) => {
        this.app.seekFrame((e as CustomEvent).detail);
      });

      this.trajectoryPanel.addEventListener("prev", () => {
        this.app.prevFrame();
      });

      this.trajectoryPanel.addEventListener("next", () => {
        this.app.nextFrame();
      });

      this.trajectoryPanel.addEventListener("play", () => {
        this.startPlayback();
      });

      this.trajectoryPanel.addEventListener("pause", () => {
        this.stopPlayback();
      });
    }

    this.setupLayoutObserver();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    this.app.events.on("info-text-change", this.infoChangeHandler);
    this.app.events.on("status-message", this.statusMessageHandler);
    this.app.events.on("mode-change", this.modeChangeHandler);
    this.app.events.on("fps-change", this.fpsChangeHandler);
    this.app.events.on("show-fps-change", this.showFpsChangeHandler);

    this.app.events.on("trajectory-change", this.trajectoryChangeHandler);
    this.app.events.on("frame-change", this.frameChangeHandler);
    this.app.events.on("length-changed", this.lengthChangeHandler);
  }

  /**
   * Remove event listeners
   */
  private removeEventListeners(): void {
    this.app.events.off("info-text-change", this.infoChangeHandler);
    this.app.events.off("status-message", this.statusMessageHandler);
    this.app.events.off("mode-change", this.modeChangeHandler);
    this.app.events.off("fps-change", this.fpsChangeHandler);
    this.app.events.off("show-fps-change", this.showFpsChangeHandler);

    this.app.events.off("trajectory-change", this.trajectoryChangeHandler);
    this.app.events.off("frame-change", this.frameChangeHandler);
    this.app.events.off("length-changed", this.lengthChangeHandler);
  }

  /**
   * Handle info text change event
   */
  private handleInfoChange(text: string): void {
    if (this.infoPanel) {
      this.infoPanel.update(text);
    }
  }

  /**
   * Handle mode change event
   */
  private handleModeChange(mode: ModeId): void {
    if (this.modePanel) {
      this.modePanel.update(mode);
    }
  }

  /**
   * Handle fps change event
   */
  private handleFpsChange(fps: number): void {
    if (this.perfPanel) {
      this.perfPanel.update(fps);
    }
  }

  private handleShowFpsChange(show: boolean): void {
    if (!this.perfPanel) return;
    if (show) this.perfPanel.show();
    else this.perfPanel.hide();
  }

  private handleTrajectoryChange(traj: Trajectory): void {
    if (this.trajectoryPanel) {
      this.applyExtent({
        indexedLength: traj.indexedLength,
        indexComplete: traj.indexComplete,
      });
      this.stopPlayback();
    }
  }

  private handleLengthChange(_event: {
    indexedLength: number;
    indexComplete: boolean;
  }): void {
    // Play/next drive `System.trajectory`. The stream may emit DCD progress
    // before that trajectory is promoted (data + DCD augment). Reading the
    // payload would show N frames while nextFrame is still clamped to 0.
    const traj = this.app.system.trajectory;
    this.applyExtent({
      indexedLength: traj.indexedLength,
      indexComplete: traj.indexComplete,
    });
  }

  private applyExtent(event: {
    indexedLength: number;
    indexComplete: boolean;
  }): void {
    if (!this.trajectoryPanel) return;
    this.trajectoryPanel.scanning = !event.indexComplete;
    this.trajectoryPanel.length = event.indexedLength;
    this.updateTrajectoryPanelLayout();
  }

  private handleFrameChange(index: number): void {
    if (this.trajectoryPanel) {
      this.trajectoryPanel.current = index;
    }
  }

  private setupLayoutObserver(): void {
    if (!this.uiOverlay) return;
    if (!this.trajectoryPanel) return;
    if (this.layoutObserver) {
      this.layoutObserver.disconnect();
      this.layoutObserver = null;
    }

    this.layoutObserver = new ResizeObserver(() => {
      this.updateTrajectoryPanelLayout();
    });
    this.layoutObserver.observe(this.uiOverlay);
  }

  private updateTrajectoryPanelLayout(): void {
    if (!this.trajectoryPanel) return;

    const width =
      this.app.canvas.clientWidth || this.uiOverlay?.clientWidth || 0;
    const height =
      this.app.canvas.clientHeight || this.uiOverlay?.clientHeight || 0;
    this.trajectoryPanel.setViewportSize(width, height);
  }

  private startPlayback() {
    if (this.playbackInterval) return;

    if (this.trajectoryPanel) {
      this.trajectoryPanel.playing = true;
    }
    this.playbackInterval = setInterval(() => {
      const sys = this.app.system;
      if (sys.trajectory.currentIndex >= sys.trajectory.indexedLength - 1) {
        // Loop or stop? Let's loop
        this.app.seekFrame(0);
      } else {
        this.app.nextFrame();
      }
    }, this.playbackSpeed);
  }

  private stopPlayback() {
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
    if (this.trajectoryPanel) {
      this.trajectoryPanel.playing = false;
    }
  }

  /**
   * Whether this manager can put a modal on screen — false until `mount()`
   * has built the overlay, and forever on a `showUI: false` app that asked
   * for no chrome. The load flow checks it before falling back to
   * {@link pickBondMapping}, so a chrome-less host gets the "bonds not drawn"
   * status message rather than a promise nothing can resolve.
   */
  public get canPrompt(): boolean {
    return this.uiOverlay !== null;
  }

  /**
   * Ask which bonds-block columns hold the endpoints; resolves `null` when
   * the user cancels. The stage's own answer to `PickBondMapping`, used by
   * hosts that render no picker of their own (`molvis-viewer`, the VS Code
   * webview). A host with its own dialog passes it to the load call instead
   * and never reaches this.
   */
  public pickBondMapping(
    filename: string,
    candidates: string[],
  ): Promise<BondColumnMapping | null> {
    if (!this.uiOverlay) return Promise.resolve(null);
    if (!this.bondMappingDialog) {
      this.bondMappingDialog = document.createElement(
        "molvis-bond-mapping-dialog",
      ) as MolvisBondMappingDialog;
      this.uiOverlay.appendChild(this.bondMappingDialog);
    }
    return this.bondMappingDialog.open(filename, candidates);
  }
}
