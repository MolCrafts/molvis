import type { MenuItem } from "../../mode/types";
import { logger } from "../../utils/logger";
import { MolvisElement } from "../base";
import { createControl } from "../builder";

/**
 * MolvisContextMenu — product-styled floating menu (tokenized surface,
 * density aligned with page popover / dropdown).
 */
export class MolvisContextMenu extends MolvisElement {
  private container: HTMLDivElement | null = null;

  public show(x: number, y: number, items: MenuItem[]): void {
    this.render();

    if (!this.container) {
      logger.error("[MolvisContextMenu] Container is null after render!");
      return;
    }

    this.container.innerHTML = "";

    if (!items) {
      logger.error("[MolvisContextMenu] No items provided to show()");
      return;
    }

    for (const item of items) {
      const control = createControl(item);
      if (control) {
        this.container.appendChild(control);
      }
    }

    this.style.left = `${x}px`;
    this.style.top = `${y}px`;
    this.style.display = "block";
    this.setAttribute("aria-hidden", "false");

    requestAnimationFrame(() => {
      this.adjustPosition(x, y);
    });
  }

  public hide(): void {
    this.style.display = "none";
    this.setAttribute("aria-hidden", "true");
  }

  /** Focusable rows inside the shadow tree (buttons + folders + bindings). */
  public focusableItems(): HTMLElement[] {
    if (!this.container) return [];
    return Array.from(
      this.container.querySelectorAll<HTMLElement>(
        "molvis-button, molvis-folder, molvis-slider",
      ),
    ).filter((el) => !el.hasAttribute("data-disabled"));
  }

  private adjustPosition(x: number, y: number): void {
    const rect = this.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (x + rect.width > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 6;
    }
    if (y + rect.height > viewportHeight) {
      adjustedY = viewportHeight - rect.height - 6;
    }

    adjustedX = Math.max(4, adjustedX);
    adjustedY = Math.max(4, adjustedY);

    this.style.left = `${adjustedX}px`;
    this.style.top = `${adjustedY}px`;
  }

  protected override render(): void {
    if (this.container) return;

    this.injectSharedStyles();

    const style = document.createElement("style");
    style.textContent = `
      :host {
        position: fixed;
        display: none;
        z-index: 10000;
        min-width: 10rem;
        max-width: 16rem;
        background: var(--bg-color);
        border: 1px solid var(--border-color);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 0.25rem;
        pointer-events: auto;
        color: var(--molvis-ui-fg, inherit);
      }
      .menu-container {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
    `;
    this.root.appendChild(style);

    this.container = document.createElement("div");
    this.container.className = "menu-container";
    this.container.setAttribute("role", "menu");
    this.root.appendChild(this.container);

    this.setAttribute("role", "presentation");
    this.setAttribute("aria-hidden", "true");
  }
}
