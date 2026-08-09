import type { MolvisApp as Molvis } from "../../app";
import type { MenuItem, SceneHit } from "../../mode/types";
import { ContextMenuHost } from "./host";

interface ContextMenuTriggerEvent {
  preventDefault(): void;
  clientX: number;
  clientY: number;
}

/**
 * Base class for mode-specific context menu controllers.
 * Each mode creates its own controller instance with mode-specific logic.
 *
 * Lifecycle (mount, resolve, wrap, registry, dismiss) lives in
 * {@link ContextMenuHost}. This class only decides *whether* and *what*.
 *
 * Event flow:
 * 1. Right-click event arrives at mode
 * 2. Mode calls contextMenuController.handleRightClick()
 * 3. Controller decides whether to show menu (via shouldShowMenu)
 * 4. If yes: builds menu items, shows via Host, returns true (consumed)
 * 5. If no: returns false, mode handles the event
 */
export abstract class ContextMenuController {
  protected readonly host: ContextMenuHost;

  constructor(
    protected app: Molvis,
    containerId: string,
  ) {
    this.host = new ContextMenuHost(app, containerId);
  }

  /**
   * Decide if menu should be shown for this event.
   * Override in subclasses to implement mode-specific logic.
   */
  protected abstract shouldShowMenu(
    hit: SceneHit | null,
    isDragging: boolean,
  ): boolean;

  /**
   * Build menu items for the current context.
   * Override in subclasses to provide mode-specific menu items.
   */
  protected abstract buildMenuItems(hit: SceneHit | null): MenuItem[];

  /**
   * Handle right-click event.
   * Returns true if event was consumed (menu shown or closed), false otherwise.
   * @param ev Mouse event from Babylon.js (IMouseEvent)
   */
  public handleRightClick(
    ev: ContextMenuTriggerEvent,
    hit: SceneHit | null,
    isDragging: boolean,
  ): boolean {
    // Close any open menu first, then open at the new hit. A pure toggle
    // forced two right-clicks to open a menu when one was already visible.
    if (this.host.isVisible) {
      this.host.hide();
    }

    if (!this.shouldShowMenu(hit, isDragging)) {
      return false;
    }

    // Gate is also inside Host; early return avoids preventDefault when disabled.
    if (this.app.config.ui?.showContextMenu === false) {
      return false;
    }

    ev.preventDefault();

    const shown = this.host.show(
      ev.clientX,
      ev.clientY,
      this.buildMenuItems(hit),
      {
        hit,
      },
    );
    return shown;
  }

  public show(x: number, y: number, items: MenuItem[]): void {
    this.host.show(x, y, items);
  }

  public hide(): void {
    this.host.hide();
  }

  public getIsVisible(): boolean {
    return this.host.isVisible;
  }

  public setOnCloseCallback(callback: () => void): void {
    this.host.setOnCloseCallback(callback);
  }

  public dispose(): void {
    this.host.dispose();
  }
}
