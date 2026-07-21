import * as path from "node:path";
import * as vscode from "vscode";
import type { RecentFilesStore } from "../loading/recentFiles";

/**
 * Activity-bar launcher: a lightweight **native** tree (no WebGL / no page
 * bundle). Replaces the previous empty TreeDataProvider + viewsWelcome text
 * with three always-visible sections:
 *
 * - **Actions** — open full workspace, pick a structure file, peek the active
 *   editor file.
 * - **Recent** — last opened molecular URIs (click → Quick View).
 * - **Help** — docs + MolVis Output channel.
 *
 * File browsing still lives in the native Explorer; this view is the
 * day-to-day home entry, not a second file tree.
 */

export type LauncherNode =
  | { kind: "section"; id: "actions" | "recent" | "help" }
  | {
      kind: "action";
      id: string;
      label: string;
      icon: string;
      command: string;
      args?: unknown[];
      description?: string;
    }
  | { kind: "recent"; uri: vscode.Uri }
  | { kind: "placeholder"; id: string; label: string }
  | {
      kind: "help";
      id: string;
      label: string;
      icon: string;
      command: string;
    };

const SECTION_LABEL = {
  actions: "Actions",
  recent: "Recent",
  help: "Help",
} as const;

/**
 * Resolve a URI from a tree click or context-menu invocation.
 * Tree item `command.arguments` pass a {@link vscode.Uri}; view context
 * menus pass the {@link LauncherNode} element (or a TreeItem with
 * `resourceUri`).
 */
export function uriFromLauncherArg(arg: unknown): vscode.Uri | undefined {
  if (!arg) return undefined;
  if (arg instanceof vscode.Uri) return arg;
  if (typeof arg === "object" && arg !== null) {
    const node = arg as Partial<LauncherNode> & {
      resourceUri?: vscode.Uri;
      uri?: vscode.Uri;
    };
    if (node.kind === "recent" && node.uri instanceof vscode.Uri) {
      return node.uri;
    }
    if (node.resourceUri instanceof vscode.Uri) {
      return node.resourceUri;
    }
    if (node.uri instanceof vscode.Uri) {
      return node.uri;
    }
  }
  return undefined;
}

export class MolvisLauncherViewProvider
  implements vscode.TreeDataProvider<LauncherNode>, vscode.Disposable
{
  public static readonly viewType = "molvis.launcher";

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    LauncherNode | undefined | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly recentFiles: RecentFilesStore) {
    this.disposables.push(
      this.recentFiles.onDidChange(() => this.refresh()),
      // Refresh "Peek active file" availability when the user switches tabs.
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.refresh()),
    );
  }

  refresh(): void {
    // undefined = "the whole tree changed" (VS Code's no-arg fire() overload
    // relies on a `| void` union that biome's noConfusingVoidType rejects).
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: LauncherNode): vscode.TreeItem {
    switch (element.kind) {
      case "section": {
        const item = new vscode.TreeItem(
          SECTION_LABEL[element.id],
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.contextValue = `molvis.section.${element.id}`;
        item.id = `section:${element.id}`;
        return item;
      }
      case "action": {
        const item = new vscode.TreeItem(
          element.label,
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon(element.icon);
        // Only set `arguments` when present. Passing `arguments: undefined`
        // has caused some VS Code builds to drop the command on tree click.
        item.command = {
          command: element.command,
          title: element.label,
          ...(element.args !== undefined ? { arguments: element.args } : {}),
        };
        item.description = element.description;
        item.contextValue = `molvis.action.${element.id}`;
        item.id = `action:${element.id}`;
        item.tooltip = element.description
          ? `${element.label} — ${element.description}`
          : element.label;
        return item;
      }
      case "recent": {
        const name = path.basename(element.uri.fsPath) || element.uri.path;
        const item = new vscode.TreeItem(
          name,
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon("file");
        item.resourceUri = element.uri;
        item.description = path.dirname(element.uri.fsPath);
        item.tooltip = element.uri.fsPath || element.uri.toString(true);
        item.contextValue = "molvis.recent";
        item.id = `recent:${element.uri.toString()}`;
        // Default click: lightweight Quick View (fast peek).
        item.command = {
          command: "molvis.quickView",
          title: "Quick View",
          arguments: [element.uri],
        };
        return item;
      }
      case "placeholder": {
        const item = new vscode.TreeItem(
          element.label,
          vscode.TreeItemCollapsibleState.None,
        );
        item.contextValue = "molvis.placeholder";
        item.id = `placeholder:${element.id}`;
        // Dimmed empty-state copy; not clickable.
        item.description = undefined;
        return item;
      }
      case "help": {
        const item = new vscode.TreeItem(
          element.label,
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon(element.icon);
        item.command = {
          command: element.command,
          title: element.label,
        };
        item.contextValue = `molvis.help.${element.id}`;
        item.id = `help:${element.id}`;
        return item;
      }
      default: {
        const _exhaustive: never = element;
        return _exhaustive;
      }
    }
  }

  getChildren(element?: LauncherNode): LauncherNode[] {
    if (!element) {
      return [
        { kind: "section", id: "actions" },
        { kind: "section", id: "recent" },
        { kind: "section", id: "help" },
      ];
    }

    if (element.kind !== "section") return [];

    switch (element.id) {
      case "actions":
        return [
          {
            kind: "action",
            id: "workspace",
            label: "Open Workspace",
            icon: "window",
            command: "molvis.openEditor",
            description: "Full UI in an editor tab",
          },
          {
            kind: "action",
            id: "openStructure",
            label: "Open Structure…",
            icon: "folder-opened",
            command: "molvis.openStructure",
            description: "Pick a file or Zarr folder",
          },
          {
            kind: "action",
            id: "peekActive",
            label: "Peek Active File",
            icon: "eye",
            command: "molvis.quickView",
            description: "Side-by-side Quick View",
          },
        ];
      case "recent": {
        const recents = this.recentFiles.list();
        if (recents.length === 0) {
          return [
            {
              kind: "placeholder",
              id: "no-recent",
              label: "No recent files yet",
            },
          ];
        }
        return recents.map((uri) => ({ kind: "recent" as const, uri }));
      }
      case "help":
        return [
          {
            kind: "help",
            id: "docs",
            label: "Documentation",
            icon: "book",
            command: "molvis.openDocs",
          },
          {
            kind: "help",
            id: "output",
            label: "Show Output Channel",
            icon: "output",
            command: "molvis.showOutput",
          },
        ];
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
