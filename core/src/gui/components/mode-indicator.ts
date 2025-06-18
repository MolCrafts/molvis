import type { HtmlGuiComponent } from "../types";
import { GUI_STYLES, applyStyles } from "../styles";

export class ModeIndicator implements HtmlGuiComponent {
  private _element: HTMLDivElement;
  private _currentMode = "";

  constructor() {
    this._element = this._createElement();
    document.body.appendChild(this._element);
  }

  get element(): HTMLElement {
    return this._element;
  }

  public updateMode(mode: string): void {
    if (this._currentMode !== mode) {
      this._currentMode = mode;
      this._element.textContent = mode.toUpperCase();
      this.show();
    }
  }

  public show(): void {
    this._element.style.display = "block";
  }

  public hide(): void {
    this._element.style.display = "none";
  }

  public dispose(): void {
    if (this._element.parentNode) {
      this._element.parentNode.removeChild(this._element);
    }
  }

  private _createElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.className = "mode-indicator";
    applyStyles(element, GUI_STYLES.baseIndicator, GUI_STYLES.modeIndicator);
    element.textContent = "VIEW"; // Default mode
    return element;
  }
}
