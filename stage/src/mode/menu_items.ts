import type { MolvisApp } from "../app";
import { FILE_FORMAT_REGISTRY } from "../io/formats";
import type { MenuItem, SceneHit } from "./types";

/**
 * Context-menu factories. Titles: at most two words (readable on small canvas).
 */
// biome-ignore lint/complexity/noStaticOnlyClass: CommonMenuItems is a public API namespace with an established static call shape
export class CommonMenuItems {
  /** Copy screenshot to clipboard. */
  static snapshot(app: MolvisApp): MenuItem {
    return {
      type: "button",
      title: "Screenshot",
      action: () => {
        void app
          .copyScreenshotToClipboard()
          .then(() =>
            app.events.emit("status-message", {
              text: "Screenshot copied",
              type: "info",
            }),
          )
          .catch((err: unknown) =>
            app.events.emit("status-message", {
              text: `Screenshot failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
              type: "error",
            }),
          );
      },
    };
  }

  /** Export — writable formats as .ext labels. */
  static export(app: MolvisApp): MenuItem {
    const formats = FILE_FORMAT_REGISTRY.filter((d) => d.writable).map((d) => ({
      format: d.format,
      label: `.${d.extensions[0]}`,
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

  /** Fit camera to scene (empty → default home pose). */
  static fitCamera(app: MolvisApp): MenuItem {
    return {
      type: "button",
      title: "Fit View",
      action: () => {
        app.world.fit();
      },
    };
  }

  /** Clear active selection content (keep list row). */
  static clearSelection(app: MolvisApp): MenuItem {
    return {
      type: "button",
      title: "Clear Select",
      action: () => {
        void app.clearActiveSelectionContent();
      },
    };
  }

  static separator(): MenuItem {
    return { type: "separator" };
  }

  static submenu(title: string, items: MenuItem[]): MenuItem {
    return { type: "folder", title, items };
  }

  /** Toggle-style button with check mark. */
  static toggle(
    title: string,
    checked: boolean,
    action: () => void,
    opts?: { disabled?: boolean; shortcut?: string },
  ): MenuItem {
    return {
      type: "button",
      title,
      checked,
      disabled: opts?.disabled,
      shortcut: opts?.shortcut,
      action,
    };
  }

  static button(
    title: string,
    action: () => void,
    opts?: { disabled?: boolean; shortcut?: string; checked?: boolean },
  ): MenuItem {
    return {
      type: "button",
      title,
      action,
      disabled: opts?.disabled,
      shortcut: opts?.shortcut,
      checked: opts?.checked,
    };
  }

  /**
   * Hit header (disabled). Atom: "Atom N" or "C N"; bond: "Bond N".
   */
  static hitLabel(hit: SceneHit): MenuItem | null {
    if (hit.type === "atom") {
      const el = hit.metadata.element?.trim();
      const id = hit.metadata.atomId;
      return {
        type: "button",
        title: el ? `${el} ${id}` : `Atom ${id}`,
        disabled: true,
        action: () => {},
      };
    }
    if (hit.type === "bond") {
      return {
        type: "button",
        title: `Bond ${hit.metadata.bondId}`,
        disabled: true,
        action: () => {},
      };
    }
    if (hit.type === "ribbon") {
      return {
        type: "button",
        title: `${hit.chainId} | ${hit.resName} ${hit.resSeq}`,
        disabled: true,
        action: () => {},
      };
    }
    return null;
  }

  /** Append Export + Screenshot. */
  static appendCommonTail(items: MenuItem[], app: MolvisApp): MenuItem[] {
    items.push(CommonMenuItems.export(app));
    items.push(CommonMenuItems.snapshot(app));
    return items;
  }
}
