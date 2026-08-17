import type { MenuItem } from "../../mode/types";
import { MolvisElement } from "../base";

type ButtonItem = Extract<MenuItem, { type: "button" }>;

/**
 * MolvisButton — context-menu row (short titles for small canvases).
 * Visual language follows product popover items via shared UI tokens.
 */
export class MolvisButton extends MolvisElement {
  private _data: ButtonItem | null = null;
  private _rendered = false;
  private row: HTMLDivElement | null = null;

  set data(item: MenuItem) {
    if (item.type !== "button") {
      throw new Error("MolvisButton only accepts button menu items");
    }
    this._data = item;
    if (!this._rendered) {
      this.render();
      this._rendered = true;
    } else {
      this.applyData();
    }
  }

  connectedCallback() {
    if (!this._rendered) {
      this.render();
      this._rendered = true;
    }
  }

  /** Keyboard / Host activation path. */
  public activate(): void {
    if (!this._data || this._data.disabled) return;
    this._data.action();
  }

  get disabled(): boolean {
    return Boolean(this._data?.disabled);
  }

  protected override render(): void {
    this.injectSharedStyles();

    const style = document.createElement("style");
    style.textContent = `
      :host {
        display: block;
      }
      .button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: var(--row-pad-y) var(--row-pad-x);
        min-height: var(--row-min-h);
        border-radius: calc(var(--radius) - 2px);
        cursor: pointer;
        user-select: none;
        transition: background-color var(--motion-fast) var(--motion-ease);
      }
      .button:hover:not(.disabled),
      .button:focus-visible:not(.disabled) {
        background: var(--hover-color);
        outline: none;
      }
      .button:focus-visible:not(.disabled) {
        box-shadow: inset 0 0 0 1px var(--accent-color);
      }
      .button.disabled {
        opacity: 0.4;
        cursor: default;
      }
      .check {
        width: 0.75rem;
        flex: 0 0 0.75rem;
        font-size: 0.75rem;
        line-height: 1;
        color: var(--accent-color);
        opacity: 0.95;
      }
      .label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .shortcut {
        flex: 0 0 auto;
        margin-left: 0.5rem;
        font-size: 0.75rem;
        color: var(--muted-fg);
        opacity: 0.9;
      }
    `;
    this.root.appendChild(style);

    const button = document.createElement("div");
    button.className = "button";
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    this.row = button;

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      this.activate();
    });

    this.root.appendChild(button);
    this.applyData();
  }

  private applyData(): void {
    if (!this.row || !this._data) return;
    const d = this._data;
    this.row.replaceChildren();

    const check = document.createElement("span");
    check.className = "check";
    check.textContent = d.checked ? "✓" : "";
    check.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = d.title;

    this.row.append(check, label);

    if (d.shortcut) {
      const sc = document.createElement("span");
      sc.className = "shortcut";
      sc.textContent = d.shortcut;
      this.row.append(sc);
    }

    const disabled = Boolean(d.disabled);
    this.row.classList.toggle("disabled", disabled);
    this.row.setAttribute("aria-disabled", disabled ? "true" : "false");
    if (d.checked !== undefined) {
      this.row.setAttribute("aria-checked", d.checked ? "true" : "false");
      this.row.setAttribute("role", "menuitemcheckbox");
    } else {
      this.row.setAttribute("role", "menuitem");
      this.row.removeAttribute("aria-checked");
    }
    if (disabled) {
      this.setAttribute("data-disabled", "");
    } else {
      this.removeAttribute("data-disabled");
    }
  }
}
