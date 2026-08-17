import type { MolvisApp } from "../../app";
import type { ModeId } from "../../mode";
import { pluginIdLeaf } from "../../plugin_id";
import type { GUIComponent } from "../types";

/**
 * ModePanel - displays current mode
 * Position: top-right
 * Shows: "View" or "Edit" based on current mode
 */
export class ModePanel implements GUIComponent {
  public element: HTMLElement;
  constructor(_app: MolvisApp) {
    this.element = this.createPanel();
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "molvis-panel molvis-mode-panel";
    panel.textContent = "View"; // Default
    return panel;
  }

  public mount(container: HTMLElement): void {
    container.appendChild(this.element);
  }

  public unmount(): void {
    this.element.remove();
  }

  public update(mode: ModeId): void {
    const leaf = pluginIdLeaf(mode);
    this.element.textContent = leaf.charAt(0).toUpperCase() + leaf.slice(1);
  }

  public show(): void {
    this.element.style.display = "block";
  }

  public hide(): void {
    this.element.style.display = "none";
  }
}
