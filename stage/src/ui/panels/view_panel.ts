import type { Observer, Scene } from "@babylonjs/core";
import type { MolvisApp } from "../../app";
import type { MenuItem } from "../../mode/types";
import { ContextMenuHost } from "../menus/host";
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
  private readonly menuHost: ContextMenuHost;
  private cameraObserver: Observer<Scene> | null = null;

  constructor(app: MolvisApp) {
    this.app = app;
    this.element = this.createPanel();
    this.menuHost = new ContextMenuHost(app, ViewPanel.MENU_ID, {
      ignoreCloseTargets: () => [this.element],
    });
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
      this.menuHost.toggle(e.clientX, e.clientY, this.buildMenuItems());
    };

    panel.addEventListener("click", handleToggle);
    panel.addEventListener("contextmenu", handleToggle);

    return panel;
  }

  private buildMenuItems(): MenuItem[] {
    // Short labels — panel menu can sit on a tiny canvas.
    return [
      {
        type: "button",
        title: "Perspective",
        action: () => {
          const camera = this.app.world.camera;
          camera.mode = 0; // PERSPECTIVE_CAMERA
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
          const dist = camera.radius;
          const fov = camera.fov;
          const aspect = this.app.world.scene
            .getEngine()
            .getAspectRatio(camera);

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
        title: "Fit View",
        action: () => {
          this.app.world.fit();
          this.updateDisplay();
        },
      },
    ];
  }

  private updateDisplay(): void {
    const camera = this.app.world.camera;

    const isOrtho = camera.mode === 1; // ORTHOGRAPHIC_CAMERA = 1

    if (isOrtho) {
      this.element.textContent = "Ortho";
      return;
    }

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
    this.menuHost.dispose();
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
