import { Logger } from "tslog";
import { ModeManager } from "./mode";
import { System } from "./system";
import { World } from "./world";
import { Executor } from "./command";
import { GuiManager } from "./gui";
import { preventEventPropagation } from "./utils";

const logger = new Logger({ name: "molvis-core" });

interface MolvisDisplayOptions {
  displayWidth?: number;
  displayHeight?: number;
  fitContainer?: boolean;
}

interface MolvisRenderOptions {
  renderWidth?: number;
  renderHeight?: number;
  pixelRatio?: number;
  autoRenderResolution?: boolean;
}

interface MolvisUIOptions {
  showUI?: boolean;
  uiComponents?: {
    showModeIndicator?: boolean;
    showViewIndicator?: boolean; 
    showInfoPanel?: boolean;
    showFrameIndicator?: boolean;
  };
}

interface MolvisOptions extends MolvisDisplayOptions, MolvisRenderOptions, MolvisUIOptions { }

class Molvis {

  private _mountPoint: HTMLElement;
  private _rootContainer!: HTMLElement;
  private _canvas!: HTMLCanvasElement;
  private _uiContainer!: HTMLElement;
  private _world!: World;
  private _system!: System;
  private _mode!: ModeManager;
  private _executor!: Executor;
  private _gui!: GuiManager;
  private _options: MolvisOptions;

  // private _artist: ArtistGuild;

  constructor(mountPoint: HTMLElement, options: MolvisOptions = {}) {
    this._mountPoint = mountPoint;
    preventEventPropagation(mountPoint);
    this._options = {

      displayWidth: 800,
      displayHeight: 600,
      fitContainer: false,
      
      renderWidth: undefined,
      renderHeight: undefined,
      pixelRatio: window.devicePixelRatio || 1,
      autoRenderResolution: true,
      
      showUI: true,
      uiComponents: {
        showModeIndicator: true,
        showViewIndicator: true,
        showInfoPanel: true,
        showFrameIndicator: true,
      },
      
      ...options
    };
    
    this._createContainerStructure();
    this._initializeComponents();
    
  }

  private _createContainerStructure(): void {
    const displayWidth = this._options.fitContainer ? '100%' : `${this._options.displayWidth}px`;
    const displayHeight = this._options.fitContainer ? '100%' : `${this._options.displayHeight}px`;
    
    let renderWidth = this._options.renderWidth;
    let renderHeight = this._options.renderHeight;
    
    if (this._options.autoRenderResolution) {
      const actualDisplayWidth = this._options.fitContainer ? 
        this._mountPoint.clientWidth : (this._options.displayWidth || 800);
      const actualDisplayHeight = this._options.fitContainer ? 
        this._mountPoint.clientHeight : (this._options.displayHeight || 600);
        
      const pixelRatio = this._options.pixelRatio || 1;
      renderWidth = Math.floor(actualDisplayWidth * pixelRatio);
      renderHeight = Math.floor(actualDisplayHeight * pixelRatio);
    }

    // Create root container
    this._rootContainer = document.createElement("div");
    this._rootContainer.className = "molvis-root";
    this._rootContainer.style.cssText = `
      position: relative;
      width: ${displayWidth};
      height: ${displayHeight};
      overflow: hidden;
    `;

    // Create canvas with specific render resolution
    this._canvas = document.createElement("canvas");
    this._canvas.className = "molvis-canvas";
    this._canvas.width = renderWidth || 800;
    this._canvas.height = renderHeight || 600;
    this._canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      touch-action: none;
    `;

    // Create UI container
    this._uiContainer = document.createElement("div");
    this._uiContainer.className = "molvis-ui";
    this._uiContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    `;

    // Assemble structure
    if (this._options.showUI) {
      this._rootContainer.appendChild(this._uiContainer);
    }
    this._rootContainer.appendChild(this._canvas);
    this._mountPoint.appendChild(this._rootContainer);
  }

  private _initializeComponents(): void {
    this._system = new System();
    this._world = new World(this._canvas);
    this._gui = new GuiManager(this, this._uiContainer, this._options.uiComponents || {});
    this._mode = new ModeManager(this);
    this._executor = new Executor(this);
  }

  get canvas(): HTMLCanvasElement {
    return this._canvas;
  }

  get world(): World {
    return this._world;
  }

  get system(): System {
    return this._system;
  }

  get scene() {
    return this._world.scene;
  }

  get mode(): ModeManager {
    return this._mode;
  }

  get executor(): Executor {
    return this._executor;
  }

  get gui(): GuiManager {
    return this._gui;
  }

  public execute(cmd: string, args: Record<string, unknown>) {
    const [meshes, entities] = this._executor.execute(cmd, args);
    this._world.pipeline.modify(
      this,
      meshes,
      entities
    )
  }

  public modify(name: string, args: Record<string, unknown>) {
    this._world.append_modifier(name, args);
  }

  public start = () => {
    this._world.render();
  };

  public stop = () => {
    this._world.stop();
  };

  public resize = () => {
    this._world.resize();
  };

  public setSize(displayWidth: number, displayHeight: number): void {
    this._options.displayWidth = displayWidth;
    this._options.displayHeight = displayHeight;
    this._options.fitContainer = false;
    
    this._rootContainer.style.width = `${displayWidth}px`;
    this._rootContainer.style.height = `${displayHeight}px`;
    
    if (this._options.autoRenderResolution) {
      const pixelRatio = this._options.pixelRatio || 1;
      this._canvas.width = Math.floor(displayWidth * pixelRatio);
      this._canvas.height = Math.floor(displayHeight * pixelRatio);
    }
    
    this._world.resize();
  }

  public setRenderResolution(renderWidth: number, renderHeight: number): void {
    this._options.renderWidth = renderWidth;
    this._options.renderHeight = renderHeight;
    this._options.autoRenderResolution = false;
    
    this._canvas.width = renderWidth;
    this._canvas.height = renderHeight;
    
    this._world.resize();
  }

  public enableFitContainer(enabled: boolean): void {
    this._options.fitContainer = enabled;
    
    if (enabled) {
      this._rootContainer.style.width = '100%';
      this._rootContainer.style.height = '100%';
      
      if (this._options.autoRenderResolution) {
        const pixelRatio = this._options.pixelRatio || 1;
        this._canvas.width = Math.floor(this._mountPoint.clientWidth * pixelRatio);
        this._canvas.height = Math.floor(this._mountPoint.clientHeight * pixelRatio);
      }
    } else {
      const displayWidth = this._options.displayWidth || 800;
      const displayHeight = this._options.displayHeight || 600;
      this._rootContainer.style.width = `${displayWidth}px`;
      this._rootContainer.style.height = `${displayHeight}px`;
    }
    
    this._world.resize();
  }

  public finalize = () => { };

  public destroy(): void {
    // Stop rendering and cleanup world
    if (this._world) {
      this._world.stop();
    }

    // Cleanup GUI components
    if (this._gui) {
      this._gui.dispose();
    }

    // Remove DOM structure
    if (this._rootContainer && this._mountPoint.contains(this._rootContainer)) {
      this._mountPoint.removeChild(this._rootContainer);
    }

    logger.info("Molvis destroyed and cleaned up");
  }

  // Additional getters for the auto-generated DOM elements
  get rootContainer(): HTMLElement {
    return this._rootContainer;
  }

  get uiContainer(): HTMLElement {
    return this._uiContainer;
  }

  get mountPoint(): HTMLElement {
    return this._mountPoint;
  }

  get options(): MolvisOptions {
    return { ...this._options };
  }
  
  get displaySize(): { width: number; height: number } {
    const rect = this._rootContainer.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
  
  get renderResolution(): { width: number; height: number } {
    return { width: this._canvas.width, height: this._canvas.height };
  }
  
  get pixelRatio(): number {
    const displaySize = this.displaySize;
    const renderRes = this.renderResolution;
    return renderRes.width / displaySize.width;
  }

  get isRunning() {
    return this._world.isRunning;
  }

}

export { Molvis };
export type { MolvisOptions };