import type { MolvisApp } from "../../app";
import type { GUIComponent } from "../types";

/** Hover readout is three lines: identity, position, then everything else. */
const INFO_LINE_LIMIT = 3;

/**
 * InfoPanel - displays atom/bond information on hover.
 * Position: bottom-left corner, left inset aligned with the view panel
 * (`.molvis-info-panel` in `../styles.ts`).
 * Same chrome as the other HUD labels: text only, no chip. At most three
 * lines; the first two stay whole and any further lines share the third.
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
    if (!text) {
      this.element.replaceChildren();
      this.hide();
      return;
    }
    const lines = text.split("\n").filter((line) => line.length > 0);
    const shown =
      lines.length <= INFO_LINE_LIMIT
        ? lines
        : [
            ...lines.slice(0, INFO_LINE_LIMIT - 1),
            lines.slice(INFO_LINE_LIMIT - 1).join(" · "),
          ];
    this.element.replaceChildren(
      ...shown.map((line) => {
        const row = document.createElement("div");
        row.className = "molvis-info-line";
        row.textContent = line;
        return row;
      }),
    );
    this.show();
  }

  public show(): void {
    this.element.classList.add("visible");
  }

  public hide(): void {
    this.element.classList.remove("visible");
  }
}
