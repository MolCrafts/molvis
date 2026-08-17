import type { MolvisApp as Molvis } from "../../app";
import type { MenuItem, SceneHit } from "../../mode/types";
import type { MolvisButton } from "../components/button";
import type { MolvisFolder } from "../components/folder";
import type { MolvisContextMenu } from "./context_menu";
import { contextMenuRegistry } from "./registry";

export interface ContextMenuHostOptions {
  /** Clicks on these targets do not dismiss the menu (e.g. ViewPanel chrome). */
  ignoreCloseTargets?: () => Iterable<EventTarget>;
}

export interface ContextMenuShowOptions {
  hit?: SceneHit | null;
}

/**
 * Single owner of floating context-menu lifecycle: mount, resolve, wrap,
 * registry mutual exclusion, document dismiss, and basic keyboard nav.
 */
export class ContextMenuHost {
  private menu: MolvisContextMenu | null = null;
  private isVisible_ = false;
  private onCloseCallback: (() => void) | null = null;
  private focusIndex = -1;

  private readonly boundHandleDocumentClick: (e: MouseEvent) => void;
  private readonly boundHandleKeyDown: (e: KeyboardEvent) => void;

  constructor(
    private readonly app: Molvis,
    private readonly menuId: string,
    private readonly options: ContextMenuHostOptions = {},
  ) {
    this.boundHandleDocumentClick = this.handleDocumentClick.bind(this);
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
  }

  get isVisible(): boolean {
    return this.isVisible_;
  }

  public setOnCloseCallback(callback: (() => void) | null): void {
    this.onCloseCallback = callback;
  }

  public show(
    x: number,
    y: number,
    items: readonly MenuItem[],
    options?: ContextMenuShowOptions,
  ): boolean {
    if (this.app.config.ui?.showContextMenu === false) {
      return false;
    }

    const resolved = this.app.resolveContextMenuItems({
      menuId: this.menuId,
      hit: options?.hit ?? null,
      items,
    });
    if (resolved.length === 0) {
      return false;
    }

    if (!this.ensureMenu()) {
      return false;
    }
    if (!this.menu) return false;

    contextMenuRegistry.activate(this.menuId, () => this.hide());
    this.menu.show(x, y, this.wrapMenuItems(resolved));
    this.isVisible_ = true;
    this.focusIndex = -1;

    setTimeout(() => {
      if (this.isVisible_) {
        this.addDocumentListeners();
        this.moveFocus(1);
      }
    }, 0);

    return true;
  }

  public hide(): void {
    this.removeDocumentListeners();

    if (this.menu) {
      this.menu.hide();
    }

    const wasVisible = this.isVisible_;
    this.isVisible_ = false;
    this.focusIndex = -1;
    contextMenuRegistry.deactivate(this.menuId);

    if (wasVisible && this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  public toggle(
    x: number,
    y: number,
    items: readonly MenuItem[],
    options?: ContextMenuShowOptions,
  ): boolean {
    if (this.isVisible_) {
      this.hide();
      return false;
    }
    return this.show(x, y, items, options);
  }

  public dispose(): void {
    this.removeDocumentListeners();
    contextMenuRegistry.deactivate(this.menuId);
    if (this.menu) {
      this.menu.remove();
      this.menu = null;
    }
    this.isVisible_ = false;
  }

  private ensureMenu(): boolean {
    if (this.menu?.isConnected) {
      return true;
    }

    const existing = document.getElementById(
      this.menuId,
    ) as MolvisContextMenu | null;
    if (existing) {
      this.menu = existing;
      return true;
    }

    const menu = document.createElement(
      "molvis-context-menu",
    ) as MolvisContextMenu;
    menu.id = this.menuId;
    this.app.uiContainer.appendChild(menu);
    this.menu = menu;
    return true;
  }

  private wrapMenuItems(items: MenuItem[]): MenuItem[] {
    return items.map((item) => {
      if (item.type === "folder") {
        return {
          ...item,
          items: this.wrapMenuItems(item.items),
        };
      }
      if (item.type !== "button") {
        return item;
      }
      if (item.disabled) {
        return item;
      }

      const originalAction = item.action;
      return {
        ...item,
        action: () => {
          try {
            originalAction();
          } finally {
            this.hide();
          }
        },
      };
    });
  }

  private focusables(): HTMLElement[] {
    return this.menu?.focusableItems() ?? [];
  }

  private moveFocus(delta: number): void {
    const items = this.focusables();
    if (items.length === 0) return;

    if (this.focusIndex < 0) {
      this.focusIndex = delta > 0 ? 0 : items.length - 1;
    } else {
      this.focusIndex =
        (this.focusIndex + delta + items.length * 8) % items.length;
    }
    this.applyFocusHighlight(items);
  }

  private applyFocusHighlight(items: HTMLElement[]): void {
    for (const el of items) {
      el.removeAttribute("data-focused");
      const inner = el.shadowRoot?.querySelector(
        ".button, .folder-row, .binding",
      ) as HTMLElement | null;
      if (inner) {
        inner.style.background = "";
      }
    }
    const current = items[this.focusIndex];
    if (!current) return;
    current.setAttribute("data-focused", "");
    const inner = current.shadowRoot?.querySelector(
      ".button, .folder-row, .binding",
    ) as HTMLElement | null;
    if (inner) {
      inner.style.background = "var(--hover-color)";
      // Prefer native focus for a11y when possible.
      inner.focus?.({ preventScroll: true });
    }
  }

  private activateFocused(): void {
    const items = this.focusables();
    const el = items[this.focusIndex];
    if (!el) return;

    if (el.tagName.toLowerCase() === "molvis-button") {
      (el as MolvisButton).activate();
      return;
    }
    if (el.tagName.toLowerCase() === "molvis-folder") {
      (el as MolvisFolder).openFlyout();
    }
  }

  private handleDocumentClick(e: MouseEvent): void {
    if (!this.isVisible_ || !this.menu) return;
    // Only primary-button clicks dismiss (not right-button / aux).
    if (typeof e.button === "number" && e.button !== 0) return;

    const path = e.composedPath();
    if (path.includes(this.menu)) return;

    const ignore = this.options.ignoreCloseTargets?.() ?? [];
    for (const target of ignore) {
      if (path.includes(target)) return;
    }

    this.hide();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isVisible_) return;

    switch (e.key) {
      case "Escape":
        this.hide();
        e.stopPropagation();
        e.preventDefault();
        break;
      case "ArrowDown":
        this.moveFocus(1);
        e.preventDefault();
        e.stopPropagation();
        break;
      case "ArrowUp":
        this.moveFocus(-1);
        e.preventDefault();
        e.stopPropagation();
        break;
      case "ArrowRight":
      case "Enter":
      case " ": {
        const items = this.focusables();
        const el = items[this.focusIndex];
        if (el?.tagName.toLowerCase() === "molvis-folder" && e.key !== " ") {
          (el as MolvisFolder).openFlyout();
          e.preventDefault();
          e.stopPropagation();
          break;
        }
        if (e.key === "Enter" || e.key === " ") {
          this.activateFocused();
          e.preventDefault();
          e.stopPropagation();
        }
        break;
      }
      case "ArrowLeft": {
        const items = this.focusables();
        const el = items[this.focusIndex];
        if (el?.tagName.toLowerCase() === "molvis-folder") {
          (el as MolvisFolder).closeFlyout();
          e.preventDefault();
          e.stopPropagation();
        }
        break;
      }
      default:
        break;
    }
  }

  private addDocumentListeners(): void {
    // Left-click outside dismisses. Do **not** listen for `contextmenu` —
    // the next right-click is owned by the mode (reopen at new hit); a
    // capture listener here closed the just-opened menu and forced a second
    // right-click to open anything.
    document.addEventListener("click", this.boundHandleDocumentClick, true);
    document.addEventListener("keydown", this.boundHandleKeyDown, true);
  }

  private removeDocumentListeners(): void {
    document.removeEventListener("click", this.boundHandleDocumentClick, true);
    document.removeEventListener("keydown", this.boundHandleKeyDown, true);
  }
}
