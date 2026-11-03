import type { MenuItem } from "../../mode/types";
import { logger } from "../../utils/logger";
import { MolvisElement } from "../base";

type FolderItem = Extract<MenuItem, { type: "folder" }>;

const FLYOUT_CLOSE_MS = 200;

function itemAt(
  items: readonly MenuItem[],
  path: readonly number[],
): MenuItem | undefined {
  let cur: MenuItem | undefined = items[path[0] ?? -1];
  for (let i = 1; i < path.length; i++) {
    if (cur?.type !== "folder") return undefined;
    cur = cur.items[path[i] ?? -1];
  }
  return cur;
}

function parsePath(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw.split(".").map((part) => Number(part));
}

function folderPreview(item: FolderItem): string {
  for (const child of item.items) {
    if (child.type === "button" && child.checked) return child.title;
  }
  return "";
}

/**
 * Single-shadow canvas menu. Rows are plain elements (one grid), not nested
 * web components — open/hover/click stay on the main thread's current frame.
 */
export class MolvisContextMenu extends MolvisElement {
  private container: HTMLDivElement | null = null;
  private flyout: HTMLDivElement | null = null;
  private items: MenuItem[] = [];
  private focusEl: HTMLElement | null = null;
  private openFolderEl: HTMLElement | null = null;
  private closeTimer: number | null = null;

  public show(x: number, y: number, items: MenuItem[]): void {
    this.render();
    if (!this.container || !this.flyout) {
      logger.error("[MolvisContextMenu] Container is null after render!");
      return;
    }

    this.items = items;
    this.closeFlyout();
    this.paint(this.container, items, []);
    this.style.left = `${x}px`;
    this.style.top = `${y}px`;
    this.style.display = "block";
    this.setAttribute("aria-hidden", "false");
    this.clampHost(x, y);
  }

  public hide(): void {
    this.closeFlyout();
    this.style.display = "none";
    this.setAttribute("aria-hidden", "true");
    this.clearFocus();
  }

  public focusableItems(): HTMLElement[] {
    const panel =
      this.openFolderEl && this.flyout ? this.flyout : this.container;
    if (!panel) return [];
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ),
    );
  }

  public moveFocus(delta: number): void {
    const items = this.focusableItems();
    if (items.length === 0) return;
    const current = this.focusEl ? items.indexOf(this.focusEl) : -1;
    let next: number;
    if (current < 0) {
      next = delta > 0 ? 0 : items.length - 1;
    } else {
      next = (current + delta + items.length) % items.length;
    }
    this.setFocus(items[next] ?? null);
  }

  public activateFocused(): void {
    const el = this.focusEl;
    if (!el) return;
    if (el.dataset.kind === "folder") {
      this.openFlyout(el, true);
      return;
    }
    this.activateRow(el);
  }

  public openFocusedFolder(): void {
    if (this.focusEl?.dataset.kind === "folder") {
      this.openFlyout(this.focusEl, true);
    }
  }

  public closeFlyout(): void {
    this.clearCloseTimer();
    if (this.openFolderEl) {
      this.openFolderEl.setAttribute("aria-expanded", "false");
      this.openFolderEl.classList.remove("open");
      this.openFolderEl = null;
    }
    if (this.flyout) {
      this.flyout.classList.remove("is-open");
      this.flyout.replaceChildren();
    }
  }

  public isFlyoutOpen(): boolean {
    return this.openFolderEl != null;
  }

  protected override render(): void {
    if (this.container) return;

    this.injectSharedStyles();
    const style = document.createElement("style");
    style.textContent = `
      :host {
        --menu-cols: 1.25rem minmax(0, 1fr) 4.25rem 1rem;
        position: fixed;
        display: none;
        z-index: 10000;
        overflow: visible;
        min-width: var(--menu-min-w);
        max-width: var(--menu-max-w);
        background: var(--bg-color);
        border: 1px solid var(--border-color);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 0.25rem;
        pointer-events: auto;
        /* Never inherit light-DOM ink: overlay defaults to dark text, while
         * the menu surface is dark gun-metal (SHARED_CSS). Match SHARED_CSS. */
        color: var(--molvis-ui-fg, oklch(0.93 0.008 255));
      }
      .menu, .flyout {
        display: flex;
        flex-direction: column;
      }
      .flyout {
        position: absolute;
        left: calc(100% - 2px);
        top: 0;
        z-index: 1;
        display: none;
        min-width: var(--menu-min-w);
        max-width: var(--menu-max-w);
        background: var(--bg-color);
        border: 1px solid var(--border-color);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 0.25rem;
      }
      .flyout.is-open { display: flex; }
      .row {
        display: grid;
        grid-template-columns: var(--menu-cols);
        align-items: center;
        column-gap: 0.25rem;
        min-height: var(--row-min-h);
        padding: 0 var(--row-pad-x);
        border-radius: var(--radius-control, 0.375rem);
        cursor: default;
        user-select: none;
      }
      .row.is-action,
      .row.is-folder {
        cursor: pointer;
      }
      .row.is-action:hover:not(.is-disabled),
      .row.is-folder:hover:not(.is-disabled),
      .row.is-folder.open:not(.is-disabled),
      .row.is-focused:not(.is-disabled) {
        background: var(--accent-color);
        color: var(--accent-fg);
      }
      .row.is-action:hover:not(.is-disabled) .check,
      .row.is-action:hover:not(.is-disabled) .meta,
      .row.is-action:hover:not(.is-disabled) .chevron,
      .row.is-folder:hover:not(.is-disabled) .check,
      .row.is-folder:hover:not(.is-disabled) .meta,
      .row.is-folder:hover:not(.is-disabled) .chevron,
      .row.is-folder.open:not(.is-disabled) .check,
      .row.is-folder.open:not(.is-disabled) .meta,
      .row.is-folder.open:not(.is-disabled) .chevron,
      .row.is-focused:not(.is-disabled) .check,
      .row.is-focused:not(.is-disabled) .meta,
      .row.is-focused:not(.is-disabled) .chevron {
        color: var(--accent-fg);
      }
      .row.is-disabled {
        opacity: 0.4;
        cursor: default;
      }
      .row.is-label {
        min-height: calc(var(--row-min-h) - 0.25rem);
        color: var(--muted-fg);
        font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
        font-size: 0.6875rem;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
      }
      .row.is-sep {
        display: block;
        min-height: 0;
        height: 1px;
        margin: 0.25rem 0;
        padding: 0;
        background: var(--border-color);
        border-radius: 0;
        pointer-events: none;
      }
      .check {
        font-size: 0.75rem;
        line-height: 1;
        text-align: center;
        color: var(--accent-color);
      }
      .label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .meta {
        justify-self: end;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.6875rem;
        color: var(--muted-fg);
        font-variant-numeric: tabular-nums;
      }
      .chevron {
        font-size: 0.75rem;
        line-height: 1;
        text-align: right;
        color: var(--muted-fg);
      }
    `;
    this.root.appendChild(style);

    this.container = document.createElement("div");
    this.container.className = "menu";
    this.container.setAttribute("role", "menu");
    this.root.appendChild(this.container);

    this.flyout = document.createElement("div");
    this.flyout.className = "flyout";
    this.flyout.setAttribute("role", "menu");
    this.root.appendChild(this.flyout);

    this.setAttribute("role", "presentation");
    this.setAttribute("aria-hidden", "true");
    this.bindPointer();
  }

  private bindPointer(): void {
    const onClick = (event: Event) => {
      const row = this.rowFromEvent(event);
      if (!row) return;
      event.stopPropagation();
      if (row.dataset.kind === "folder") {
        this.openFlyout(row, false);
        return;
      }
      if (row.dataset.kind === "item") {
        this.activateRow(row);
      }
    };
    const onOver = (event: Event) => {
      const row = this.rowFromEvent(event);
      if (!row) return;
      if (row.dataset.kind === "folder") {
        this.openFlyout(row, false);
        return;
      }
      if (row.dataset.kind === "item" && row.parentElement === this.container) {
        this.closeFlyoutSoon();
      }
    };

    this.container?.addEventListener("click", onClick);
    this.container?.addEventListener("mouseover", onOver);
    this.flyout?.addEventListener("click", onClick);
    this.flyout?.addEventListener("mouseover", onOver);
    this.flyout?.addEventListener("mouseenter", () => {
      this.clearCloseTimer();
    });
    this.flyout?.addEventListener("mouseleave", () => {
      this.closeFlyoutSoon();
    });
    this.addEventListener("mouseenter", () => {
      this.clearCloseTimer();
    });
    this.addEventListener("mouseleave", (event) => {
      if (this.pointerStaysInside(event)) return;
      this.closeFlyoutSoon();
    });
  }

  private pointerStaysInside(event: MouseEvent): boolean {
    const rel = event.relatedTarget;
    if (!(rel instanceof Node)) return false;
    return this === rel || Boolean(this.shadowRoot?.contains(rel));
  }

  private rowFromEvent(event: Event): HTMLElement | null {
    const path = event.composedPath();
    for (const node of path) {
      if (node instanceof HTMLElement && node.classList.contains("row")) {
        if (node.classList.contains("is-disabled")) return null;
        if (node.dataset.kind === "item" || node.dataset.kind === "folder") {
          return node;
        }
        return null;
      }
    }
    return null;
  }

  private paint(
    panel: HTMLElement,
    items: readonly MenuItem[],
    parentPath: number[],
  ): void {
    panel.replaceChildren();
    items.forEach((item, index) => {
      const row = this.makeRow(item, [...parentPath, index]);
      if (row) panel.appendChild(row);
    });
  }

  private makeRow(item: MenuItem, path: number[]): HTMLElement | null {
    if (item.type === "separator") {
      const sep = document.createElement("div");
      sep.className = "row is-sep";
      sep.setAttribute("role", "separator");
      return sep;
    }
    if (item.type === "label") {
      const label = document.createElement("div");
      label.className = "row is-label";
      label.append(
        cell("check", ""),
        cell("label", item.title),
        cell("meta", ""),
        cell("chevron", ""),
      );
      return label;
    }
    if (item.type === "binding") {
      return null;
    }
    if (item.type === "folder") {
      const row = document.createElement("div");
      row.className = "row is-folder";
      row.dataset.kind = "folder";
      row.dataset.path = path.join(".");
      row.setAttribute("role", "menuitem");
      row.setAttribute("aria-haspopup", "true");
      row.setAttribute("aria-expanded", "false");
      if (item.disabled) {
        row.classList.add("is-disabled");
        row.setAttribute("aria-disabled", "true");
      }
      row.append(
        cell("check", ""),
        cell("label", item.title),
        cell("meta", folderPreview(item)),
        cell("chevron", "›"),
      );
      return row;
    }

    const row = document.createElement("div");
    row.className = "row is-action";
    row.dataset.kind = "item";
    row.dataset.path = path.join(".");
    row.setAttribute(
      "role",
      item.checked === undefined ? "menuitem" : "menuitemcheckbox",
    );
    if (item.checked !== undefined) {
      row.setAttribute("aria-checked", item.checked ? "true" : "false");
    }
    if (item.disabled) {
      row.classList.add("is-disabled");
      row.setAttribute("aria-disabled", "true");
    }
    row.append(
      cell("check", item.checked ? "✓" : ""),
      cell("label", item.title),
      cell("meta", item.shortcut ?? ""),
      cell("chevron", ""),
    );
    return row;
  }

  private activateRow(row: HTMLElement): void {
    const item = itemAt(this.items, parsePath(row.dataset.path));
    if (item?.type !== "button" || item.disabled) return;
    item.action();
  }

  private openFlyout(row: HTMLElement, focusFirst: boolean): void {
    this.clearCloseTimer();
    const item = itemAt(this.items, parsePath(row.dataset.path));
    if (item?.type !== "folder" || item.disabled || !this.flyout) return;

    if (
      this.openFolderEl === row &&
      this.flyout.classList.contains("is-open")
    ) {
      if (focusFirst) this.focusFirstFlyoutRow();
      return;
    }

    if (this.openFolderEl && this.openFolderEl !== row) {
      this.openFolderEl.setAttribute("aria-expanded", "false");
      this.openFolderEl.classList.remove("open");
    }

    this.openFolderEl = row;
    row.classList.add("open");
    row.setAttribute("aria-expanded", "true");
    this.paint(this.flyout, item.items, parsePath(row.dataset.path));
    this.flyout.classList.add("is-open");
    this.positionFlyout(row);
    if (focusFirst) this.focusFirstFlyoutRow();
  }

  private focusFirstFlyoutRow(): void {
    const first = this.flyout?.querySelector<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])',
    );
    this.setFocus(first ?? null);
  }

  private closeFlyoutSoon(): void {
    this.clearCloseTimer();
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      this.closeFlyout();
    }, FLYOUT_CLOSE_MS);
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private positionFlyout(row: HTMLElement): void {
    if (!this.flyout) return;
    const hostRect = this.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    this.flyout.style.top = `${rowRect.top - hostRect.top - 2}px`;
    this.flyout.style.left = "calc(100% - 2px)";
    this.flyout.style.right = "auto";
    const w = this.flyout.offsetWidth;
    const clip = this.clipRect();
    if (hostRect.right + w > clip.right) {
      this.flyout.style.left = "auto";
      this.flyout.style.right = "calc(100% - 2px)";
    }
    const flyRect = this.flyout.getBoundingClientRect();
    if (flyRect.bottom > clip.bottom) {
      const overflow = flyRect.bottom - clip.bottom;
      this.flyout.style.top = `${rowRect.top - hostRect.top - 2 - overflow}px`;
    }
  }

  private clipRect(): DOMRect {
    const root = this.closest(".molvis-root");
    if (root instanceof HTMLElement) return root.getBoundingClientRect();
    return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  }

  private clampHost(x: number, y: number): void {
    const rect = this.getBoundingClientRect();
    let left = x;
    let top = y;
    if (x + rect.width > window.innerWidth) {
      left = window.innerWidth - rect.width - 4;
    }
    if (y + rect.height > window.innerHeight) {
      top = window.innerHeight - rect.height - 4;
    }
    this.style.left = `${Math.max(4, left)}px`;
    this.style.top = `${Math.max(4, top)}px`;
  }

  private setFocus(el: HTMLElement | null): void {
    if (this.focusEl) this.focusEl.classList.remove("is-focused");
    this.focusEl = el;
    if (el) {
      el.classList.add("is-focused");
      el.focus?.({ preventScroll: true });
    }
  }

  private clearFocus(): void {
    this.setFocus(null);
  }
}

function cell(className: string, text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}
