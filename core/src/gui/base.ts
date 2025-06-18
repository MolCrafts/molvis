import type { Molvis } from "@molvis/core";
import type { GuiComponent } from "./types";
import { ModeIndicator } from "./components/mode-indicator";
import { ViewIndicator } from "./components/view-indicator";
import { InfoPanel } from "./components/info-panel";
import { FrameIndicator } from "./components/frame-indicator";

interface GuiOptions {
  showModeIndicator?: boolean;
  showViewIndicator?: boolean;
  showInfoPanel?: boolean;
  showFrameIndicator?: boolean;
}

class GuiManager {
  private _app: Molvis;
  private _components: Map<string, GuiComponent> = new Map();
  
  // Component instances
  private _modeIndicator!: ModeIndicator;
  private _viewIndicator!: ViewIndicator;
  private _infoPanel!: InfoPanel;
  private _frameIndicator!: FrameIndicator;

  constructor(app: Molvis, options: GuiOptions = {}) {
    this._app = app;
    this._initializeComponents(options);
    this._setupEventListeners();
    this._initializeDefaultStates();
    console.log("GUI Manager initialized with components:", Array.from(this._components.keys()));
  }

  private _initializeComponents(options: GuiOptions): void {
    // Create components
    this._modeIndicator = new ModeIndicator();
    this._viewIndicator = new ViewIndicator();
    this._infoPanel = new InfoPanel();
    this._frameIndicator = new FrameIndicator(this._app);

    // Register components
    this._components.set('mode', this._modeIndicator);
    this._components.set('view', this._viewIndicator);
    this._components.set('info', this._infoPanel);
    this._components.set('frame', this._frameIndicator);

    // Apply initial visibility based on options
    if (options.showModeIndicator !== false) this._modeIndicator.show();
    else this._modeIndicator.hide();
    
    if (options.showViewIndicator !== false) this._viewIndicator.show();
    else this._viewIndicator.hide();
    
    if (options.showInfoPanel !== false) this._infoPanel.show();
    else this._infoPanel.hide();
    
    if (options.showFrameIndicator !== false) this._frameIndicator.show();
    else this._frameIndicator.hide();
  }

  private _setupEventListeners(): void {
    // Listen for mode changes - you'll need to implement these events in your app
    // this._app.on('modeChanged', (mode: string) => {
    //   this._modeIndicator.updateMode(mode);
    // });

    // Listen for view changes
    // this._app.on('viewChanged', (isOrthographic: boolean) => {
    //   this._viewIndicator.updateView(isOrthographic);
    // });

    // Listen for frame changes
    // this._app.on('frameChanged', (current: number, total: number) => {
    //   this._frameIndicator.updateFrame(current, total);
    // });
  }

  private _initializeDefaultStates(): void {
    // Initialize with actual current mode (with safety check)
    if (this._app.mode?.currentModeName) {
      const currentModeName = this._app.mode.currentModeName;
      this._modeIndicator.updateMode(currentModeName);
    } else {
      // Fallback to default mode
      this._modeIndicator.updateMode("edit");
    }
    
    // Initialize with actual current view mode (with safety check)
    if (this._app.world?.isOrthographic) {
      const isOrthographic = this._app.world.isOrthographic();
      this._viewIndicator.updateView(isOrthographic);
    } else {
      // Fallback to default view (perspective)
      this._viewIndicator.updateView(false);
    }
    
    // Initialize frame indicator with current state (with safety check)
    if (this._app.system) {
      this._frameIndicator.updateFrame(
        this._app.system.current_frame_index,
        this._app.system.n_frames
      );
    } else {
      // Fallback to default frame state
      this._frameIndicator.updateFrame(0, 0);
    }
  }

  // Public API methods
  public updateMode(mode: string): void {
    this._modeIndicator.updateMode(mode);
  }

  public updateView(isOrthographic: boolean): void {
    this._viewIndicator.updateView(isOrthographic);
  }

  public updateInfoText(text: string): void {
    this._infoPanel.updateText(text);
  }

  public updateFrameIndicator(current: number, total: number): void {
    this._frameIndicator.updateFrame(current, total);
  }

  // Component management
  public getComponent<T extends GuiComponent>(name: string): T | undefined {
    return this._components.get(name) as T;
  }

  public showComponent(name: string): void {
    this._components.get(name)?.show();
  }

  public hideComponent(name: string): void {
    this._components.get(name)?.hide();
  }

  public dispose(): void {
    for (const component of this._components.values()) {
      component.dispose();
    }
    this._components.clear();
  }
}

export { GuiManager };
export type { GuiOptions };
