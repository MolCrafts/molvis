/**
 * Global registry to keep context menus mutually exclusive.
 * Only one context menu owner can stay active at a time.
 */
class ContextMenuRegistry {
  private activeOwnerId: string | null = null;
  private activeHide: (() => void) | null = null;

  public activate(ownerId: string, hide: () => void): void {
    if (
      this.activeOwnerId &&
      this.activeOwnerId !== ownerId &&
      this.activeHide
    ) {
      this.activeHide();
    }

    this.activeOwnerId = ownerId;
    this.activeHide = hide;
  }

  public deactivate(ownerId: string): void {
    if (this.activeOwnerId !== ownerId) {
      return;
    }
    this.activeOwnerId = null;
    this.activeHide = null;
  }
}

export const contextMenuRegistry = new ContextMenuRegistry();
