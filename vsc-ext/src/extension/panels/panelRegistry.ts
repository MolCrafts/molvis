import type { PanelHandle, PanelRegistry, WebviewPanelMeta } from "../types";

/**
 * In-memory registry for active webview panels and their reload metadata.
 * Accepts both `WebviewPanel` and `WebviewView` via the {@link PanelHandle}
 * structural type so a single broadcast path serves all surfaces.
 */
export class InMemoryPanelRegistry implements PanelRegistry {
  private readonly panels = new Map<PanelHandle, WebviewPanelMeta>();

  public register(panel: PanelHandle, meta: WebviewPanelMeta): void {
    this.panels.set(panel, meta);
  }

  public unregister(panel: PanelHandle): void {
    this.panels.delete(panel);
  }

  public getRegisteredViewTypes(): readonly string[] {
    const types: string[] = [];
    for (const [panel, meta] of this.panels) {
      // Prefer explicit viewType in meta (used by WebviewView providers);
      // fall back to the panel's own viewType (WebviewPanel).
      const vt = meta.viewType ?? (panel as { viewType?: string }).viewType;
      if (vt) types.push(vt);
    }
    return types;
  }

  public async forEachVisible(
    callback: (
      panel: PanelHandle,
      meta: WebviewPanelMeta,
    ) => Promise<void> | void,
  ): Promise<void> {
    for (const [panel, meta] of this.panels) {
      if (panel.visible) {
        await callback(panel, meta);
      }
    }
  }

  public async forEach(
    callback: (
      panel: PanelHandle,
      meta: WebviewPanelMeta,
    ) => Promise<void> | void,
  ): Promise<void> {
    for (const [panel, meta] of this.panels) {
      await callback(panel, meta);
    }
  }
}
