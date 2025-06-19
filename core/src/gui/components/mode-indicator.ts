import type { HtmlGuiComponent } from "../types";
import { GUI_STYLES, applyStyles } from "../styles";

export class ModeIndicator implements HtmlGuiComponent {
  private _element: HTMLDivElement;
  private _currentMode = "";

  constructor(container: HTMLElement) {
    this._element = this._createElement();
    container.appendChild(this._element);
  }

  get element(): HTMLElement {
    return this._element;
  }

  public updateMode(mode: string): void {
    if (this._currentMode !== mode) {
      this._currentMode = mode;
      this._element.textContent = mode.toUpperCase();
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
    // 移除默认文本，保持为空直到有实际模式更新
    element.style.display = "none"; // 默认隐藏
    return element;
  }
}
