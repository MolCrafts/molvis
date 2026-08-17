import * as vscode from "vscode";
import type { StructureOutlineNode, StructureOutlinePayload } from "../types";

export type OutlineTreeItem = StructureOutlineNode & {
  /** Flattened atom indices for this node (leaf or aggregate). */
  atomIndices: number[];
};

/**
 * Native VS Code tree of chain → residue → atom for the active MolVis
 * workspace. Populated from webview `structureOutline` messages; click
 * posts `selectAtoms` back via the callback.
 */
export class StructureOutlineProvider
  implements vscode.TreeDataProvider<OutlineTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    OutlineTreeItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private roots: OutlineTreeItem[] = [];

  constructor(private readonly onSelectAtoms: (indices: number[]) => void) {}

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  setOutline(payload: StructureOutlinePayload | null): void {
    this.roots = payload ? payload.roots.map((n) => hydrate(n)) : [];
    this._onDidChangeTreeData.fire(undefined);
  }

  clear(): void {
    this.setOutline(null);
  }

  getTreeItem(element: OutlineTreeItem): vscode.TreeItem {
    const collapsible =
      element.children && element.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(element.label, collapsible);
    item.id = element.id;
    item.contextValue = `molvis.outline.${element.kind}`;
    item.description =
      element.kind === "residue" || element.kind === "chain"
        ? `${element.atomIndices.length} atoms`
        : undefined;
    item.command = {
      command: "molvis.outline.select",
      title: "Select",
      arguments: [element],
    };
    item.iconPath = iconFor(element.kind);
    return item;
  }

  getChildren(element?: OutlineTreeItem): OutlineTreeItem[] {
    if (!element) return this.roots;
    return (element.children ?? []).map((c) => hydrate(c));
  }

  select(element: OutlineTreeItem): void {
    if (element.atomIndices.length === 0) return;
    this.onSelectAtoms(element.atomIndices);
  }
}

function hydrate(node: StructureOutlineNode): OutlineTreeItem {
  const children = node.children?.map(hydrate);
  let atomIndices = node.atomIndices ?? [];
  if (atomIndices.length === 0 && children) {
    atomIndices = children.flatMap((c) => c.atomIndices);
  }
  return { ...node, children, atomIndices };
}

function iconFor(kind: StructureOutlineNode["kind"]): vscode.ThemeIcon {
  switch (kind) {
    case "chain":
      return new vscode.ThemeIcon("type-hierarchy-sub");
    case "residue":
      return new vscode.ThemeIcon("symbol-namespace");
    case "atom":
      return new vscode.ThemeIcon("circle-filled");
    default:
      return new vscode.ThemeIcon("symbol-misc");
  }
}
