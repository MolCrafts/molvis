import type { Observer, Scene } from "@babylonjs/core";
import type { MolvisApp } from "../../app";
import type { MenuItem } from "../../mode/types";
import type { MolvisContextMenu } from "../menus/context_menu";
import { contextMenuRegistry } from "../menus/registry";
import type { GUIComponent } from "../types";

/**
 * ViewPanel - displays current camera view/projection
 * Position: top-left
 * Shows: "Front" or "Back" or "Persp" or "Ortho" based on current state
 */
export class ViewPanel implements GUIComponent {
  private static readonly MENU_ID = "molvis-view-panel-menu";

  public element: HTMLElement;
  private app: MolvisApp;
  private menu: MolvisContextMenu | null = null;
  private isMenuVisible = false;
  private cameraObserver: Observer<Scene> | null = null;

  // Bound handlers so listeners can be removed safely.
  private readonly boundHandleDocumentClick: (e: MouseEvent) => void;
  private readonly boundHandleKeyDown: (e: KeyboardEvent) => void;

  constructor(app: MolvisApp) {
    this.app = app;
    this.boundHandleDocumentClick = this.handleDocumentClick.bind(this);
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.element = this.createPanel();
    this.updateDisplay();
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "molvis-panel molvis-view-panel";
    panel.style.cursor = "pointer";
    panel.title = "Click to potential view options";

    const handleToggle = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleMenu(e.clientX, e.clientY);
    };

    panel.addEventListener("click", handleToggle);
    panel.addEventListener("contextmenu", handleToggle);

    return panel;
  }

  private toggleMenu(x: number, y: number): void {
    if (this.isMenuVisible) {
      this.hideMenu();
      return;
    }
    this.showMenu(x, y);
  }

  private buildMenuItems(): MenuItem[] {
    const items: MenuItem[] = [
      {
        type: "button",
        title: "Perspective",
        action: () => {
          const camera = this.app.world.camera;
          camera.mode = 0; // PERSPECTIVE_CAMERA
          // Clear ortho bounds to avoid interference if we switch back and forth differently
          camera.orthoLeft = null;
          camera.orthoRight = null;
          camera.orthoTop = null;
          camera.orthoBottom = null;
          this.updateDisplay();
        },
      },
      {
        type: "button",
        title: "Orthographic",
        action: () => {
          const camera = this.app.world.camera;
          // Calculate current view size at target to match perspective view
          const dist = camera.radius;
          const fov = camera.fov;
          const aspect = this.app.world.scene
            .getEngine()
            .getAspectRatio(camera);

          // Height at target distance
          const height = 2 * dist * Math.tan(fov / 2);
          const width = height * aspect;

          camera.orthoTop = height / 2;
          camera.orthoBottom = -height / 2;
          camera.orthoLeft = -width / 2;
          camera.orthoRight = width / 2;

          camera.mode = 1; // ORTHOGRAPHIC_CAMERA
          this.updateDisplay();
        },
      },
      {
        type: "button",
        title: "Front",
        action: () => {
          const camera = this.app.world.camera;
          camera.alpha = Math.PI / 2;
          camera.beta = Math.PI / 2;
          this.updateDisplay();
        },
      },
      {
        type: "button",
        title: "Back",
        action: () => {
          const camera = this.app.world.camera;
          camera.alpha = -Math.PI / 2;
          camera.beta = Math.PI / 2;
          this.updateDisplay();
        },
      },
      {
        type: "button",
        title: "Left",
        action: () => {
          const camera = this.app.world.camera;
          camera.alpha = Math.PI;
          camera.beta = Math.PI / 2;
          this.updateDisplay();
        },
      },
      {
        type: "button",
        title: "Right",
        action: () => {
          const camera = this.app.world.camera;
          camera.alpha = 0;
          camera.beta = Math.PI / 2;
          this.updateDisplay();
        },
      },
      {
        type: "button",
        title: "Top",
        action: () => {
          const camera = this.app.world.camera;
          camera.alpha = 0;
          camera.beta = 0;
          this.updateDisplay();
        },
      },
      {
        type: "button",
        title: "Bottom",
        action: () => {
          const camera = this.app.world.camera;
          camera.alpha = 0;
          camera.beta = Math.PI;
          this.updateDisplay();
        },
      },
      { type: "separator" },
      {
        type: "button",
        title: "Reset Camera",
        action: () => {
          // Keep behavior consistent with mode context menus.
          this.app.world.resetCamera();
          this.updateDisplay();
        },
      },
    ];

    return items.map((item) => {
      if (item.type !== "button" || !item.action) {
        return item;
      }

      const originalAction = item.action;
      return {
        ...item,
        action: () => {
          try {
            originalAction();
          } finally {
            this.hideMenu();
          }
        },
      };
    });
  }

  private showMenu(x: number, y: number): void {
    if (this.app.config.ui?.showContextMenu === false) return;
    if (!this.ensureMenu()) return;
    if (!this.menu) return;

    const items = this.wrapMenuItems(
      this.app.resolveContextMenuItems({
        menuId: ViewPanel.MENU_ID,
        hit: null,
        items: this.buildMenuItems(),
      }),
    );
    contextMenuRegistry.activate(ViewPanel.MENU_ID, () => this.hideMenu());
    this.menu.show(x, y, items);
    this.isMenuVisible = true;

    // Delay listener registration so the current click won't immediately close the menu.
    setTimeout(() => {
      this.addDocumentListeners();
    }, 0);
  }

  private hideMenu(): void {
    this.removeDocumentListeners();
    if (this.menu) {
      this.menu.hide();
    }
    this.isMenuVisible = false;
    contextMenuRegistry.deactivate(ViewPanel.MENU_ID);
  }

  private ensureMenu(): boolean {
    if (this.menu?.isConnected) {
      return true;
    }

    const existing = document.getElementById(
      ViewPanel.MENU_ID,
    ) as MolvisContextMenu | null;
    if (existing) {
      this.menu = existing;
      return true;
    }

    const menu = document.createElement(
      "molvis-context-menu",
    ) as MolvisContextMenu;
    menu.id = ViewPanel.MENU_ID;
    this.app.uiContainer.appendChild(menu);
    this.menu = menu;
    return true;
  }

  private wrapMenuItems(items: MenuItem[]): MenuItem[] {
    return items.map((item) => {
      if (item.type === "folder") {
        return { ...item, items: this.wrapMenuItems(item.items) };
      }
      if (item.type !== "button") {
        return item;
      }

      const originalAction = item.action;
      return {
        ...item,
        action: () => {
          try {
            originalAction();
          } finally {
            this.hideMenu();
          }
        },
      };
    });
  }

  private handleDocumentClick(e: MouseEvent): void {
    if (!this.isMenuVisible || !this.menu) return;

    const path = e.composedPath();
    const clickInsideMenu = path.includes(this.menu);
    const clickInsidePanel = path.includes(this.element);
    if (!clickInsideMenu && !clickInsidePanel) {
      this.hideMenu();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isMenuVisible) return;
    if (e.key !== "Escape") return;
    this.hideMenu();
    e.stopPropagation();
    e.preventDefault();
  }

  private addDocumentListeners(): void {
    document.addEventListener("click", this.boundHandleDocumentClick, true);
    document.addEventListener(
      "contextmenu",
      this.boundHandleDocumentClick,
      true,
    );
    document.addEventListener("keydown", this.boundHandleKeyDown, true);
  }

  private removeDocumentListeners(): void {
    document.removeEventListener("click", this.boundHandleDocumentClick, true);
    document.removeEventListener(
      "contextmenu",
      this.boundHandleDocumentClick,
      true,
    );
    document.removeEventListener("keydown", this.boundHandleKeyDown, true);
  }

  private updateDisplay(): void {
    const camera = this.app.world.camera;

    // Check projection mode first
    const isOrtho = camera.mode === 1; // ORTHOGRAPHIC_CAMERA = 1

    if (isOrtho) {
      this.element.textContent = "Ortho";
      return;
    }

    // In perspective mode, check if we're in a specific view
    const alpha = this.normalizeAngle(camera.alpha);
    const beta = camera.beta;

    // Z-up mapping: Front => +Y, Back => -Y.
    if (
      Math.abs(alpha - Math.PI / 2) < 0.1 &&
      Math.abs(beta - Math.PI / 2) < 0.1
    ) {
      this.element.textContent = "Front";
      return;
    }

    if (
      Math.abs(alpha + Math.PI / 2) < 0.1 &&
      Math.abs(beta - Math.PI / 2) < 0.1
    ) {
      this.element.textContent = "Back";
      return;
    }

    // Default to Persp for perspective mode
    this.element.textContent = "Persp";
  }

  private normalizeAngle(value: number): number {
    const wrapped = value % (2 * Math.PI);
    if (wrapped > Math.PI) {
      return wrapped - 2 * Math.PI;
    }
    if (wrapped < -Math.PI) {
      return wrapped + 2 * Math.PI;
    }
    return wrapped;
  }

  public mount(container: HTMLElement): void {
    container.appendChild(this.element);

    // Update display when camera changes
    this.cameraObserver = this.app.world.scene.onBeforeRenderObservable.add(
      () => {
        this.updateDisplay();
      },
    );
  }

  public unmount(): void {
    if (this.cameraObserver) {
      this.app.world.scene.onBeforeRenderObservable.remove(this.cameraObserver);
      this.cameraObserver = null;
    }
    this.hideMenu();
    if (this.menu) {
      this.menu.remove();
      this.menu = null;
    }
    this.element.remove();
  }

  public update(_data: unknown): void {
    this.updateDisplay();
  }

  public show(): void {
    this.element.style.display = "block";
  }

  public hide(): void {
    this.element.style.display = "none";
  }
}
