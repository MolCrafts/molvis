import type { HtmlGuiComponent } from "../types";
import { GUI_STYLES, applyStyles } from "../styles";

export class ViewIndicator implements HtmlGuiComponent {
  private _element: HTMLDivElement;
  private _isOrthographic = false;

  constructor() {
    this._element = this._createElement();
    document.body.appendChild(this._element);
  }

  get element(): HTMLElement {
    return this._element;
  }

  public updateView(isOrthographic: boolean): void {
    if (this._isOrthographic !== isOrthographic) {
      this._isOrthographic = isOrthographic;
      this._element.textContent = isOrthographic ? "ORTHO" : "PERSP";
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
    element.className = "view-indicator";
    applyStyles(element, GUI_STYLES.baseIndicator, GUI_STYLES.viewIndicator);
    element.textContent = "PERSP"; // Default view
    return element;
  }
}
