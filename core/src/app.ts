import { Logger } from "tslog";
import { ModeManager } from "./mode";
import { System } from "./system";
import { World } from "./world";
import { Executor } from "./command";
import { GuiManager } from "./gui";
// import { ArtistGuild } from "./artist";

const logger = new Logger({ name: "molvis-core" });

interface MolvisDisplayOptions {
  /** 显示尺寸：widget在页面上的CSS尺寸 */
  displayWidth?: number;
  displayHeight?: number;
  /** 是否自适应容器尺寸（优先级高于displayWidth/Height） */
  fitContainer?: boolean;
}

interface MolvisRenderOptions {
  /** 渲染分辨率：canvas实际像素分辨率 */
  renderWidth?: number;
  renderHeight?: number;
  /** 像素比例：控制渲染质量，默认使用devicePixelRatio */
  pixelRatio?: number;
  /** 是否自动根据显示尺寸计算渲染分辨率 */
  autoRenderResolution?: boolean;
}

interface MolvisUIOptions {
  /** 是否显示UI组件 */
  showUI?: boolean;
  /** UI组件选项 */
  uiComponents?: {
    showModeIndicator?: boolean;
    showViewIndicator?: boolean; 
    showInfoPanel?: boolean;
    showFrameIndicator?: boolean;
  };
}

interface MolvisOptions extends MolvisDisplayOptions, MolvisRenderOptions, MolvisUIOptions {
  /** 调试模式 */
  debug?: boolean;
}

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
    this._options = {
      // 显示尺寸默认值
      displayWidth: 800,
      displayHeight: 600,
      fitContainer: false,
      
      // 渲染分辨率默认值
      renderWidth: undefined, // 将自动计算
      renderHeight: undefined, // 将自动计算
      pixelRatio: window.devicePixelRatio || 1,
      autoRenderResolution: true,
      
      // UI选项默认值
      showUI: true,
      uiComponents: {
        showModeIndicator: true,
        showViewIndicator: true,
        showInfoPanel: true,
        showFrameIndicator: true,
      },
      
      debug: false,
      ...options
    };
    
    this._createContainerStructure();
    this._initializeComponents();
    
    logger.info("Molvis initialized with auto-generated container structure");
  }

  private _createContainerStructure(): void {
    // 计算显示尺寸
    const displayWidth = this._options.fitContainer ? '100%' : `${this._options.displayWidth}px`;
    const displayHeight = this._options.fitContainer ? '100%' : `${this._options.displayHeight}px`;
    
    // 计算渲染分辨率
    let renderWidth = this._options.renderWidth;
    let renderHeight = this._options.renderHeight;
    
    if (this._options.autoRenderResolution) {
      // 自动计算渲染分辨率：显示尺寸 * 像素比例
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
    
    if (this._options.debug) {
      console.log(`Molvis Display: ${displayWidth} x ${displayHeight}`);
      console.log(`Molvis Render: ${this._canvas.width} x ${this._canvas.height}`);
      console.log(`Pixel Ratio: ${this._options.pixelRatio}`);
    }
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

  // get artist(): ArtistGuild {
  //   return this._artist;
  // }

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
    
    // 重新计算渲染分辨率
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
      
      // 重新计算渲染分辨率
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