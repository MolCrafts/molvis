import type { MolvisApp } from "../app";
import { FILE_FORMAT_REGISTRY } from "../io/formats";
import type { MenuItem } from "./types";

/**
 * Common menu item factory functions
 * These ensure consistent behavior across all modes
 */
export class CommonMenuItems {
  /**
   * Snapshot menu item - takes a screenshot
   */
  static snapshot(app: MolvisApp): MenuItem {
    return {
      type: "button",
      title: "Snapshot to Clipboard",
      action: () => {
        void app
          .copyScreenshotToClipboard()
          .then(() =>
            app.events.emit("status-message", {
              text: "Snapshot copied to clipboard",
              type: "info",
            }),
          )
          .catch((err: unknown) =>
            app.events.emit("status-message", {
              text: `Snapshot failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
              type: "error",
            }),
          );
      },
    };
  }

  /**
   * Export menu item - emits `export-requested`. The host UI registers a
   * handler (page or vsc-ext) and owns the actual file-write. Core never
   * touches the writer.
   */
  static export(app: MolvisApp): MenuItem {
    // Writable formats come straight from the format registry (every entry
    // molrs has a writer for). Selecting one emits `export-requested` with the
    // chosen format; the host owns the write.
    const formats = FILE_FORMAT_REGISTRY.filter((d) => d.writable).map((d) => ({
      format: d.format,
      label: `${d.label} (.${d.extensions[0]})`,
    }));
    return {
      type: "folder",
      title: "Export",
      items: formats.map(({ format, label }) => ({
        type: "button",
        title: label,
        action: () => {
          app.events.emit("export-requested", { format });
        },
      })),
    };
  }

  /**
   * Reset Camera menu item - resets camera to default position
   */
  static resetCamera(app: MolvisApp): MenuItem {
    return {
      type: "button",
      title: "Reset Camera",
      action: () => {
        app.world.resetCamera();
      },
    };
  }

  /**
   * Clear Selection menu item - clears all selected entities
   */
  static clearSelection(app: MolvisApp): MenuItem {
    return {
      type: "button",
      title: "Clear Selection",
      action: () => {
        app.world.selectionManager.apply({ type: "clear" });
      },
    };
  }

  /**
   * Separator menu item
   */
  static separator(): MenuItem {
    return { type: "separator" };
  }

  /** Wrap items in a flyout submenu (rendered by MolvisFolder). */
  static submenu(title: string, items: MenuItem[]): MenuItem {
    return { type: "folder", title, items };
  }

  /**
   * Append export + snapshot as the final menu items.
   */
  static appendCommonTail(items: MenuItem[], app: MolvisApp): MenuItem[] {
    items.push(CommonMenuItems.export(app));
    items.push(CommonMenuItems.snapshot(app));
    return items;
  }
}
