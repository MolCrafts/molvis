import { BaseMode, ModeType } from "./base";
import type { Molvis } from "@molvis/core";
import type { PointerInfo } from "@babylonjs/core";
import { Pane } from "tweakpane";

class ViewModeMenu {
  private container: HTMLDivElement | null = null;
  private pane: Pane | null = null;
  private containerId: string;
  private isBuilt: boolean = false;

  constructor(private vm: ViewMode) {
    this.containerId = "molvis-view-menu";
  }

  private build() {
    // Check if container already exists
    const existingContainer = this.vm.molvisApp.uiContainer?.querySelector(`#${this.containerId}`) as HTMLDivElement;
    
    if (existingContainer) {
      // Reuse existing container
      this.container = existingContainer;
      // Clean up existing Pane
      if (this.pane) {
        this.pane.dispose();
      }
    } else {
      // Create new menu container
      this.container = document.createElement("div");
      this.container.id = this.containerId;
      this.container.className = "MolvisModeMenu";
      this.container.style.position = "fixed"; // Use fixed positioning to avoid parent container influence
      this.container.style.zIndex = "9999"; // High z-index to ensure menu is on top
      this.container.style.pointerEvents = "auto"; // Ensure menu is clickable
      
      // Mount to app's uiContainer instead of document.body
      if (this.vm.molvisApp.uiContainer) {
        this.vm.molvisApp.uiContainer.appendChild(this.container);
      } else {
        // Fallback to body mount if uiContainer doesn't exist
        document.body.appendChild(this.container);
      }
    }
    
    this.pane = new Pane({ container: this.container });
    this.pane.hidden = true;

    // Build menu content
    this.buildMenuContent();
    this.isBuilt = true;
  }

  private buildMenuContent() {
    if (!this.pane) return;

    // Clear existing menu items
    for (const c of this.pane.children) {
      this.pane.remove(c);
    }

    this.pane.addBinding(this.vm, "currentViewMode", {
      label: "mode",
      options: {
        persp: "persp",
        ortho: "ortho", 
        front: "front",
        back: "back",
        left: "left",
        right: "right",
      },
    });
    this.pane.addBlade({
      view: 'separator',
    });
    this.pane.addButton({ title: "snapshot" }).on("click", () => {
      this.vm.takeScreenShot();
    });
  }

  public show(x: number, y: number) {
    // Lazy build: only build when first shown
    if (!this.isBuilt) {
      this.build();
    }
    
    if (this.container && this.pane) {
      this.container.style.left = `${x}px`;
      this.container.style.top = `${y}px`;
      this.pane.hidden = false;
    }
  }

  public hide() {
    if (this.pane) {
      this.pane.hidden = true;
    }
  }

  public dispose() {
    if (this.pane) {
      this.pane.dispose();
      this.pane = null;
    }
    // Don't remove container, keep it for reuse
    // if (this.container?.parentNode) {
    //   this.container.parentNode.removeChild(this.container);
    // }
    this.container = null;
    this.isBuilt = false;
  }
}

class ViewMode extends BaseMode {
  private menu: ViewModeMenu;
  private viewMode = "perspective";
  
  constructor(app: Molvis) {
    super(ModeType.View, app);
    this.menu = new ViewModeMenu(this);
  }

  // Provide method for ViewModeMenu to access app
  public get molvisApp(): Molvis {
    return this.app;
  }

  get currentViewMode(): string {
    return this.viewMode;
  }
  
  set currentViewMode(value: string) {
    this.viewMode = value;
    switch (value) {
      case "perspective":
        this.setPerspective();
        break;
      case "ortho":
        this.setOrthographic();
        break;
      case "front":
        this.viewFront();
        break;
      case "back":
        this.viewBack();
        break;
      case "left":
        this.viewLeft();
        break;
      case "right":
        this.viewRight();
        break;
    }
  }

  protected showContextMenu(x: number, y: number): void {
    this.menu.show(x, y);
  }
  protected hideContextMenu(): void {
    this.menu.hide();
  }

  // 公共方法供菜单使用
  public setPerspective(): void {
    this.world.setPerspective();
    if (this.gui) {
      this.gui.updateView(false); // false = perspective
    }
  }
  
  public setOrthographic(): void {
    this.world.setOrthographic();
    if (this.gui) {
      this.gui.updateView(true); // true = orthographic
    }
  }
  
  public viewFront(): void {
    this.world.viewFront();
  }
  
  public viewBack(): void {
    this.world.viewBack();
  }
  
  public viewLeft(): void {
    this.world.viewLeft();
  }
  
  public viewRight(): void {
    this.world.viewRight();
  }
  
  public takeScreenShot(): void {
    this.world.takeScreenShot();
  }

  public override finish(): void {
    // Clean up menu
    if (this.menu) {
      this.menu.dispose();
    }
    
    // Call parent finish method
    super.finish();
  }

  override _on_pointer_down(pointerInfo: PointerInfo) {
    super._on_pointer_down(pointerInfo);
    if (pointerInfo.event.button === 0) {
    }
  }

  override _on_pointer_up(pointerInfo: PointerInfo) {
    super._on_pointer_up(pointerInfo);
  }

  override _on_pointer_move(_pointerInfo: PointerInfo) {
    // ViewMode inherits atom info display functionality from BaseMode
    super._on_pointer_move(_pointerInfo);
  }
}

export { ViewMode };
