import type * as vscode from "vscode";

/**
 * Empty tree provider for the MolVis activity-bar launcher view.
 *
 * The view intentionally holds no items — its entire content is the
 * declarative `viewsWelcome` block in `package.json` (an "Open MolVis
 * Workspace" button plus a pointer to the Explorer context menu).
 * Registering a provider that returns no children is what makes VSCode
 * render that welcome content instead of a "no data provider" placeholder.
 *
 * This deliberately replaces the previous heavyweight approach of hosting
 * the entire React page (WebGL + WASM engine) inside the narrow activity-bar
 * sidebar. The full workspace now lives in an editor tab (`molvis.openEditor`
 * → `molvis.workspace`), and file browsing is delegated to the native
 * Explorer via the `explorer/context` menu + custom editors.
 */
export class MolvisLauncherViewProvider
  implements vscode.TreeDataProvider<never>
{
  public static readonly viewType = "molvis.launcher";

  getTreeItem(element: never): vscode.TreeItem {
    return element;
  }

  getChildren(): never[] {
    return [];
  }
}
