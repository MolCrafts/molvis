import type { MolvisApp } from "../../app";
import type { GUIComponent } from "../types";

/**
 * InfoPanel - displays atom/bond information on hover
 * Position: bottom-left
 */
export class InfoPanel implements GUIComponent {
  public element: HTMLElement;
  constructor(_app: MolvisApp) {
    this.element = this.createPanel();
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "molvis-panel molvis-info-panel";
    return panel;
  }

  public mount(container: HTMLElement): void {
    container.appendChild(this.element);
  }

  public unmount(): void {
    this.element.remove();
  }

  public update(text: string): void {
    if (text) {
      this.element.textContent = text;
      this.show();
    } else {
      this.hide();
    }
  }

  public show(): void {
    this.element.classList.add("visible");
  }

  public hide(): void {
    this.element.classList.remove("visible");
  }
}
