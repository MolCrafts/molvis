import type { MenuItem } from "../../mode/types";
import { MolvisElement } from "../base";
import { createControl } from "../builder";

/**
 * MolvisFolder — a submenu row that opens a flyout panel of nested items on
 * hover. The row shows the folder title plus a ▸ chevron; the flyout is a
 * fixed-positioned panel (so it escapes the parent menu's box) opened to the
 * right of the row, flipping left near the viewport edge. Nested folders
 * recurse — a folder item inside the flyout is just another MolvisFolder.
 */
export class MolvisFolder extends MolvisElement {
  private _data: Extract<MenuItem, { type: "folder" }> | null = null;
  private _rendered = false;
  private panel: HTMLDivElement | null = null;
  private row: HTMLDivElement | null = null;
  private closeTimer: number | null = null;

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

  protected override render(): void {
    // Clear previous content to prevent duplication
    this.root.innerHTML = "";

    this.injectSharedStyles();

    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; position: relative; }

      .folder-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 12px;
        cursor: default;
        user-select: none;
        transition: background-color 0.15s;
      }
      .folder-row:hover, .folder-row.open { background: var(--hover-color); }
      .folder-chevron { opacity: 0.6; font-size: 10px; }

      .submenu {
        position: fixed;
        display: none;
        min-width: 180px;
        max-width: 300px;
        background: var(--bg-color);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        padding: 4px 0;
        z-index: 10001;
      }
      .submenu.visible { display: block; }
    `;
    this.root.appendChild(style);

    const row = document.createElement("div");
    row.className = "folder-row";
    const title = document.createElement("span");
    title.textContent = this._data?.title ?? "";
    const chevron = document.createElement("span");
    chevron.className = "folder-chevron";
    chevron.textContent = "▸"; // ▸
    row.append(title, chevron);
    this.root.appendChild(row);
    this.row = row;

    const panel = document.createElement("div");
    panel.className = "submenu";
    if (this._data) {
      for (const item of this._data.items) {
        const control = createControl(item);
        if (control) panel.appendChild(control);
      }
    }
    this.root.appendChild(panel);
    this.panel = panel;

    // The flyout is a DOM descendant of this host, so hovering it keeps
    // mouseleave from firing — one enter/leave pair on the host covers both
    // the row and the (fixed-positioned) panel.
    this.addEventListener("mouseenter", () => this.open());
    this.addEventListener("mouseleave", () => this.scheduleClose());
  }

  private open(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (!this.panel || !this.row) return;
    this.row.classList.add("open");
    this.panel.classList.add("visible");
    this.position();
  }

  private scheduleClose(): void {
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      this.panel?.classList.remove("visible");
      this.row?.classList.remove("open");
    }, 180);
  }

  /** Place the flyout to the right of the row, flipping to the left and
   *  clamping vertically when it would overflow the viewport. */
  private position(): void {
    if (!this.panel || !this.row) return;
    const rowRect = this.row.getBoundingClientRect();
    const panelRect = this.panel.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rowRect.right - 2;
    if (left + panelRect.width > vw - margin) {
      left = rowRect.left - panelRect.width + 2; // flip to the left
    }
    left = Math.max(margin, left);

    let top = rowRect.top - 4;
    if (top + panelRect.height > vh - margin) {
      top = vh - panelRect.height - margin;
    }
    top = Math.max(margin, top);

    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${top}px`;
  }
}
