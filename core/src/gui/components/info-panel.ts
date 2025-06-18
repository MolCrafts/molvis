import type { HtmlGuiComponent } from "../types";
import { GUI_STYLES, applyStyles } from "../styles";

export class InfoPanel implements HtmlGuiComponent {
  private _element: HTMLDivElement;

  constructor() {
    this._element = this._createElement();
    document.body.appendChild(this._element);
  }

  get element(): HTMLElement {
    return this._element;
  }

  public updateText(text: string): void {
    this._element.textContent = text;
    if (text) {
      this.show();
    } else {
      this.hide();
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
    element.className = "info-panel";
    applyStyles(element, GUI_STYLES.infoPanel);
    return element;
  }
}
