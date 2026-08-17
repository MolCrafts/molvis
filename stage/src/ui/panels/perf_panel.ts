import type { MolvisApp } from "../../app";
import type { GUIComponent } from "../types";

/**
 * PerfPanel - displays current FPS
 * Position: bottom-right
 */
export class PerfPanel implements GUIComponent {
  public element: HTMLElement;
  constructor(_app: MolvisApp) {
    this.element = this.createPanel();
    this.update(0);
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "molvis-panel molvis-perf-panel";
    return panel;
  }

  public mount(container: HTMLElement): void {
    container.appendChild(this.element);
  }

  public unmount(): void {
    this.element.remove();
  }

  public update(fps: number): void {
    const rounded = Math.round(fps);
    this.element.textContent = `FPS: ${rounded}`;
  }

  public show(): void {
    this.element.style.display = "block";
  }

  public hide(): void {
    this.element.style.display = "none";
  }
}
