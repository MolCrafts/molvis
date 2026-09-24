import type { MolvisApp } from "../../app";
import type { GUIComponent } from "../types";

/**
 * InfoPanel - displays atom/bond information on hover
 * Position: bottom-left, clear of the corner axis triad (see
 * `TRIAD_CLEARANCE_VAR` / `.molvis-info-panel` in `../styles.ts`).
 */
export class InfoPanel implements GUIComponent {
  public element: HTMLElement;
  private readonly header: HTMLElement;
  private readonly body: HTMLElement;

  constructor(_app: MolvisApp) {
    this.header = document.createElement("div");
    this.header.className = "molvis-info-panel__header";
    this.body = document.createElement("div");
    this.body.className = "molvis-info-panel__body";
    this.element = this.createPanel();
    this.element.append(this.header, this.body);
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

  /**
   * First line is the identity (what was picked); the rest are its data
   * rows. Split so the header can carry weight without the text stream
   * (`info-text-change`) having to know anything about markup.
   */
  public update(text: string): void {
    if (!text) {
      this.hide();
      return;
    }
    const split = text.indexOf("\n");
    const head = split === -1 ? text : text.slice(0, split);
    const rest = split === -1 ? "" : text.slice(split + 1);
    this.header.textContent = head;
    this.body.textContent = rest;
    this.body.classList.toggle("molvis-info-panel__body--empty", !rest);
    this.show();
  }

  public show(): void {
    this.element.classList.add("visible");
  }

  public hide(): void {
    this.element.classList.remove("visible");
  }
}
