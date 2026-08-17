import type { MenuItem } from "../../mode/types";
import { MolvisElement } from "../base";
import { createControl } from "../builder";

type FolderItem = Extract<MenuItem, { type: "folder" }>;

/**
 * MolvisFolder — dense submenu row.
 * Opens on hover **or** click/Enter (touch-friendly); flyout flips at edges.
 * Surface tokens match {@link MolvisContextMenu}.
 */
export class MolvisFolder extends MolvisElement {
  private _data: FolderItem | null = null;
  private _rendered = false;
  private panel: HTMLDivElement | null = null;
  private row: HTMLDivElement | null = null;
  private closeTimer: number | null = null;
  private pinnedOpen = false;

  set data(item: MenuItem) {
    if (item.type !== "folder") {
      throw new Error("MolvisFolder only accepts folder menu items");
    }
    this._data = item;
    if (!this._rendered) {
      this.render();
      this._rendered = true;
    }
  }

  connectedCallback() {
    if (!this._rendered) {
      this.render();
      this._rendered = true;
    }
  }

  disconnectedCallback() {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  get disabled(): boolean {
    return Boolean(this._data?.disabled);
  }

  get isOpen(): boolean {
    return Boolean(this.panel?.classList.contains("visible"));
  }

  /** Host / keyboard: open flyout. */
  public openFlyout(): void {
    if (this.disabled) return;
    this.pinnedOpen = true;
    this.open();
  }

  /** Host / keyboard: close flyout. */
  public closeFlyout(): void {
    this.pinnedOpen = false;
    this.closeNow();
  }

  protected override render(): void {
    this.root.innerHTML = "";
    this.injectSharedStyles();

    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; position: relative; }

      .folder-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: var(--row-pad-y) var(--row-pad-x);
        min-height: var(--row-min-h);
        border-radius: calc(var(--radius) - 2px);
        cursor: default;
        user-select: none;
        transition: background-color var(--motion-fast) var(--motion-ease);
      }
      .folder-row:hover:not(.disabled),
      .folder-row.open:not(.disabled),
      .folder-row:focus-visible:not(.disabled) {
        background: var(--hover-color);
        outline: none;
      }
      .folder-row:focus-visible:not(.disabled) {
        box-shadow: inset 0 0 0 1px var(--accent-color);
      }
      .folder-row.disabled {
        opacity: 0.4;
        cursor: default;
      }
      .folder-title {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .folder-chevron {
        color: var(--muted-fg);
        opacity: 0.85;
        font-size: 0.75rem;
        flex: 0 0 auto;
      }

      .submenu {
        position: fixed;
        display: none;
        min-width: 10rem;
        max-width: 16rem;
        background: var(--bg-color);
        border: 1px solid var(--border-color);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 0.25rem;
        z-index: 10001;
      }
      .submenu.visible { display: flex; flex-direction: column; gap: 1px; }
    `;
    this.root.appendChild(style);

    const row = document.createElement("div");
    row.className = "folder-row";
    row.setAttribute("role", "menuitem");
    row.setAttribute("aria-haspopup", "true");
    row.setAttribute("aria-expanded", "false");
    row.tabIndex = -1;

    const title = document.createElement("span");
    title.className = "folder-title";
    title.textContent = this._data?.title ?? "";
    const chevron = document.createElement("span");
    chevron.className = "folder-chevron";
    chevron.textContent = "▸";
    chevron.setAttribute("aria-hidden", "true");
    row.append(title, chevron);
    this.root.appendChild(row);
    this.row = row;

    if (this._data?.disabled) {
      row.classList.add("disabled");
      row.setAttribute("aria-disabled", "true");
      this.setAttribute("data-disabled", "");
    }

    const panel = document.createElement("div");
    panel.className = "submenu";
    panel.setAttribute("role", "menu");
    if (this._data) {
      for (const item of this._data.items) {
        const control = createControl(item);
        if (control) panel.appendChild(control);
      }
    }
    this.root.appendChild(panel);
    this.panel = panel;

    if (!this._data?.disabled) {
      this.addEventListener("mouseenter", () => this.open());
      this.addEventListener("mouseleave", () => {
        if (!this.pinnedOpen) this.scheduleClose();
      });
      // Click / touch toggles pin so flyout stays open without hover.
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.isOpen && this.pinnedOpen) {
          this.closeFlyout();
        } else {
          this.openFlyout();
        }
      });
    }
  }

  private open(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (!this.panel || !this.row || this.disabled) return;
    this.row.classList.add("open");
    this.panel.classList.add("visible");
    this.row.setAttribute("aria-expanded", "true");
    this.position();
  }

  private scheduleClose(): void {
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      if (!this.pinnedOpen) this.closeNow();
    }, 180);
  }

  private closeNow(): void {
    this.panel?.classList.remove("visible");
    this.row?.classList.remove("open");
    this.row?.setAttribute("aria-expanded", "false");
  }

  private position(): void {
    if (!this.panel || !this.row) return;
    const rowRect = this.row.getBoundingClientRect();
    const panelRect = this.panel.getBoundingClientRect();
    const margin = 4;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rowRect.right - 2;
    if (left + panelRect.width > vw - margin) {
      left = rowRect.left - panelRect.width + 2;
    }
    left = Math.max(margin, left);

    let top = rowRect.top - 2;
    if (top + panelRect.height > vh - margin) {
      top = vh - panelRect.height - margin;
    }
    top = Math.max(margin, top);

    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${top}px`;
  }
}
